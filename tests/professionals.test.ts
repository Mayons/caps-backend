import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/common/prisma';
import { api, createProfessional, createSpecialty, createUser, resetDatabase, tokenFor } from './helpers';

beforeEach(resetDatabase);

async function setupInvitation(email = 'dra.lopez@example.com') {
  const admin = await createUser('ADMIN');
  const specialty = await createSpecialty();
  const created = await api()
    .post('/api/v1/professionals')
    .set('Authorization', admin.auth)
    .send({ firstName: 'Laura', lastName: 'López', email, phone: '0000 111111', specialtyIds: [specialty.id] });
  expect(created.status).toBe(201);
  expect(created.body.hasLinkedAccount).toBe(false);

  const invitation = await api()
    .post(`/api/v1/professionals/${created.body.id}/invitations`)
    .set('Authorization', admin.auth);
  expect(invitation.status).toBe(201);
  return { admin, professionalId: created.body.id as string, token: invitation.body.token as string };
}

describe('Gestión de profesionales', () => {
  it('el admin crea profesionales con varias especialidades', async () => {
    const admin = await createUser('ADMIN');
    const [a, b] = [await createSpecialty('Clínica'), await createSpecialty('Pediatría')];
    const res = await api()
      .post('/api/v1/professionals')
      .set('Authorization', admin.auth)
      .send({ firstName: 'Juan', lastName: 'Paz', email: ' JUAN@Example.com ', phone: '0000 222222', specialtyIds: [a.id, b.id, a.id] });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('juan@example.com');
    expect(res.body.specialties).toHaveLength(2);
  });

  it('el listado público no expone datos de contacto', async () => {
    const specialty = await createSpecialty();
    await createProfessional([specialty.id]);
    const res = await api().get(`/api/v1/professionals?specialtyId=${specialty.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty('email');
    expect(res.body[0]).not.toHaveProperty('phone');
  });

  it('un gestor de turnos no puede crear invitaciones', async () => {
    const manager = await createUser('APPOINTMENT_MANAGER');
    const professional = await createProfessional([(await createSpecialty()).id]);
    const res = await api().post(`/api/v1/professionals/${professional.id}/invitations`).set('Authorization', manager.auth);
    expect(res.status).toBe(403);
  });
});

describe('Vinculación segura de profesionales', () => {
  it('vincula la cuenta con invitación válida + email verificado coincidente', async () => {
    const { professionalId, token } = await setupInvitation();
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });

    const res = await api().post('/api/v1/professionals/link').set('Authorization', patient.auth).send({ token });
    expect(res.status).toBe(200);
    expect(res.body.professionalId).toBe(professionalId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: patient.user.id } });
    expect(user.role).toBe('PROFESSIONAL');
    // El token nunca se guarda en texto plano.
    const invitation = await prisma.professionalInvitation.findFirstOrThrow({ where: { professionalId } });
    expect(invitation.tokenHash).not.toBe(token);
  });

  it('rechaza una invitación ya utilizada', async () => {
    const { token } = await setupInvitation();
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    await api().post('/api/v1/professionals/link').set('Authorization', patient.auth).send({ token });

    const other = await createUser('PATIENT');
    const res = await api().post('/api/v1/professionals/link').set('Authorization', other.auth).send({ token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVITATION_USED');
  });

  it('no vincula si el email es distinto aunque el token sea válido', async () => {
    const { token } = await setupInvitation();
    const intruder = await createUser('PATIENT', { email: 'otra.persona@example.com' });
    const res = await api().post('/api/v1/professionals/link').set('Authorization', intruder.auth).send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
  });

  it('no vincula por coincidencia de email sin un token válido', async () => {
    await setupInvitation();
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    const res = await api()
      .post('/api/v1/professionals/link')
      .set('Authorization', patient.auth)
      .send({ token: 'token-inventado-que-no-existe-123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVITATION_INVALID');
  });

  it('exige el email verificado en Firebase', async () => {
    const { token } = await setupInvitation();
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    const res = await api()
      .post('/api/v1/professionals/link')
      .set('Authorization', tokenFor(patient.user.firebaseUid!, patient.user.email, false))
      .send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rechaza invitaciones vencidas', async () => {
    const { token, professionalId } = await setupInvitation();
    await prisma.professionalInvitation.updateMany({ where: { professionalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    const res = await api().post('/api/v1/professionals/link').set('Authorization', patient.auth).send({ token });
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
  });

  it('rechaza invitaciones revocadas', async () => {
    const { token, professionalId, admin } = await setupInvitation();
    await api().delete(`/api/v1/professionals/${professionalId}/invitations`).set('Authorization', admin.auth);
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    const res = await api().post('/api/v1/professionals/link').set('Authorization', patient.auth).send({ token });
    expect(res.body.error.code).toBe('INVITATION_REVOKED');
  });

  it('el Super Admin revoca el acceso sin borrar el profesional', async () => {
    const { token, professionalId } = await setupInvitation();
    const patient = await createUser('PATIENT', { email: 'dra.lopez@example.com' });
    await api().post('/api/v1/professionals/link').set('Authorization', patient.auth).send({ token });

    const admin = await createUser('ADMIN');
    const denied = await api().post(`/api/v1/professionals/${professionalId}/revoke-access`).set('Authorization', admin.auth);
    expect(denied.status).toBe(403);

    const superAdmin = await createUser('SUPER_ADMIN');
    const res = await api().post(`/api/v1/professionals/${professionalId}/revoke-access`).set('Authorization', superAdmin.auth);
    expect(res.status).toBe(200);
    expect(res.body.hasLinkedAccount).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: patient.user.id } })).role).toBe('PATIENT');
    expect(await prisma.professional.count({ where: { id: professionalId } })).toBe(1);
  });
});
