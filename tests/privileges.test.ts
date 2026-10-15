import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/common/prisma';
import { api, createBlock, createProfessional, createSpecialty, createUser, futureDay, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('Prevención de escalada de privilegios', () => {
  it('un paciente no puede cambiar su rol editando su perfil', async () => {
    const { user, auth } = await createUser('PATIENT');
    const res = await api().patch('/api/v1/auth/me').set('Authorization', auth).send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('PATIENT');
  });

  it('un administrador puede listar usuarios pero no modificar su propio rol', async () => {
    const admin = await createUser('ADMIN');
    const res = await api()
      .patch(`/api/v1/users/${admin.user.id}/role`)
      .set('Authorization', admin.auth)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(403);

    const list = await api().get('/api/v1/users').set('Authorization', admin.auth);
    expect(list.status).toBe(200);
  });

  it('un administrador puede asignar gestores pero no escalar privilegios ni revocar accesos', async () => {
    const admin = await createUser('ADMIN');
    const patient = await createUser('PATIENT');
    const otherAdmin = await createUser('ADMIN');
    const superAdmin = await createUser('SUPER_ADMIN');
    const allowed = await api().patch(`/api/v1/users/${patient.user.id}/role`)
      .set('Authorization', admin.auth).send({ role: 'APPOINTMENT_MANAGER' });
    expect(allowed.status).toBe(200);
    for (const [id, role] of [
      [patient.user.id, 'ADMIN'],
      [otherAdmin.user.id, 'PATIENT'],
      [superAdmin.user.id, 'PATIENT'],
    ]) {
      const denied = await api().patch(`/api/v1/users/${id}/role`)
        .set('Authorization', admin.auth).send({ role });
      expect(denied.status).toBe(403);
    }
    const status = await api().patch(`/api/v1/users/${patient.user.id}/status`)
      .set('Authorization', admin.auth).send({ isActive: false });
    expect(status.status).toBe(403);
  });

  it('el Super Admin puede crear administradores', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const patient = await createUser('PATIENT');
    const res = await api()
      .patch(`/api/v1/users/${patient.user.id}/role`)
      .set('Authorization', superAdmin.auth)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it('el administrador da de alta perfiles sin poder crear roles superiores', async () => {
    const admin = await createUser('ADMIN');
    const data = { email: 'Nuevo@Example.com', firstName: 'Nueva', lastName: 'Persona', role: 'APPOINTMENT_MANAGER' };
    const created = await api().post('/api/v1/users').set('Authorization', admin.auth).send(data);
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('nuevo@example.com');
    expect(created.body.role).toBe('APPOINTMENT_MANAGER');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } })).firebaseUid).toBeNull();
    const duplicate = await api().post('/api/v1/users').set('Authorization', admin.auth).send(data);
    expect(duplicate.status).toBe(409);
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'PROFESSIONAL']) {
      const denied = await api().post('/api/v1/users').set('Authorization', admin.auth)
        .send({ ...data, email: 'otra@example.com', role });
      expect([400, 403]).toContain(denied.status);
    }
    const superAdmin = await createUser('SUPER_ADMIN');
    const allowed = await api().post('/api/v1/users').set('Authorization', superAdmin.auth)
      .send({ ...data, email: 'admin@example.com', role: 'ADMIN' });
    expect(allowed.status).toBe(201);
  });

  it('los roles no administrativos no pueden dar de alta ni listar usuarios', async () => {
    for (const role of ['PATIENT', 'PROFESSIONAL', 'APPOINTMENT_MANAGER'] as const) {
      const actor = await createUser(role);
      expect((await api().get('/api/v1/users').set('Authorization', actor.auth)).status).toBe(403);
      expect((await api().post('/api/v1/users').set('Authorization', actor.auth)
        .send({ email: 'nuevo@example.com', firstName: 'Nuevo', lastName: 'Usuario', role: 'PATIENT' })).status).toBe(403);
    }
  });

  it('nadie puede asignar SUPER_ADMIN ni PROFESSIONAL por la API', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const patient = await createUser('PATIENT');
    for (const role of ['SUPER_ADMIN', 'PROFESSIONAL']) {
      const res = await api()
        .patch(`/api/v1/users/${patient.user.id}/role`)
        .set('Authorization', superAdmin.auth)
        .send({ role });
      expect(res.status).toBe(400);
    }
  });

  it('el Super Admin no puede modificarse a sí mismo ni a otro Super Admin', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const other = await createUser('SUPER_ADMIN');

    const self = await api()
      .patch(`/api/v1/users/${superAdmin.user.id}/status`)
      .set('Authorization', superAdmin.auth)
      .send({ isActive: false });
    expect(self.status).toBe(403);

    const demote = await api()
      .patch(`/api/v1/users/${other.user.id}/role`)
      .set('Authorization', superAdmin.auth)
      .send({ role: 'PATIENT' });
    expect(demote.status).toBe(403);
  });

  it('el Super Admin puede revocar el acceso de un administrador', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const admin = await createUser('ADMIN');
    const res = await api()
      .patch(`/api/v1/users/${admin.user.id}/status`)
      .set('Authorization', superAdmin.auth)
      .send({ isActive: false });
    expect(res.status).toBe(200);

    const after = await api().get('/api/v1/specialties/manage').set('Authorization', admin.auth);
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('USER_INACTIVE');
  });

  it('pacientes y gestores no pueden administrar especialidades', async () => {
    for (const role of ['PATIENT', 'APPOINTMENT_MANAGER', 'PROFESSIONAL'] as const) {
      const { auth } = await createUser(role);
      const res = await api().post('/api/v1/specialties').set('Authorization', auth).send({ name: 'Nueva' });
      expect(res.status).toBe(403);
    }
  });

  it('solo el Super Admin elimina perfiles sin historial y nunca su propia cuenta', async () => {
    const admin = await createUser('ADMIN');
    const superAdmin = await createUser('SUPER_ADMIN');
    const target = await createUser('PATIENT');
    expect((await api().delete(`/api/v1/users/${target.user.id}`).set('Authorization', admin.auth)).status).toBe(403);
    expect((await api().delete(`/api/v1/users/${superAdmin.user.id}`).set('Authorization', superAdmin.auth)).status).toBe(403);
    const otherSuper = await createUser('SUPER_ADMIN');
    expect((await api().delete(`/api/v1/users/${otherSuper.user.id}`).set('Authorization', superAdmin.auth)).status).toBe(403);
    expect((await api().delete(`/api/v1/users/${target.user.id}`).set('Authorization', superAdmin.auth)).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: target.user.id } })).toBeNull();
  });

  it('conserva perfiles con historial o ficha profesional', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const target = await createUser('PROFESSIONAL');
    const professional = await createProfessional([(await createSpecialty()).id], { userId: target.user.id });
    const linked = await api().delete(`/api/v1/users/${target.user.id}`).set('Authorization', superAdmin.auth);
    expect(linked.status).toBe(409);
    const block = await createBlock(professional.id, futureDay());
    const withHistory = await api().delete(`/api/v1/users/${block.createdByUserId}`).set('Authorization', superAdmin.auth);
    expect(withHistory.status).toBe(409);
    expect(withHistory.body.error.code).toBe('USER_HAS_RECORDS');
  });
});
