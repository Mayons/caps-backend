import { beforeEach, describe, expect, it } from 'vitest';
import { api, at, createBlock, createProfessional, createSpecialty, createUser, futureDay, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('Creación de disponibilidad por roles autorizados', () => {
  it('el gestor de turnos crea bloques para cualquier profesional', async () => {
    const manager = await createUser('APPOINTMENT_MANAGER');
    const professional = await createProfessional([(await createSpecialty()).id]);
    const day = futureDay();
    const res = await api()
      .post('/api/v1/availability')
      .set('Authorization', manager.auth)
      .send({ professionalId: professional.id, startAt: at(day, '09:00'), endAt: at(day, '12:00') });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('un paciente no puede crear disponibilidad', async () => {
    const patient = await createUser('PATIENT');
    const professional = await createProfessional([(await createSpecialty()).id]);
    const day = futureDay();
    const res = await api()
      .post('/api/v1/availability')
      .set('Authorization', patient.auth)
      .send({ professionalId: professional.id, startAt: at(day, '09:00'), endAt: at(day, '12:00') });
    expect(res.status).toBe(403);
  });

  it('un profesional solo crea disponibilidad propia y con el permiso habilitado', async () => {
    const specialty = await createSpecialty();
    const withoutPermission = await createUser('PROFESSIONAL');
    const ownWithout = await createProfessional([specialty.id], { userId: withoutPermission.user.id });
    const withPermission = await createUser('PROFESSIONAL');
    const ownWith = await createProfessional([specialty.id], {
      userId: withPermission.user.id,
      allowAvailabilityManagement: true,
    });
    const day = futureDay();
    const body = (professionalId: string) => ({ professionalId, startAt: at(day, '09:00'), endAt: at(day, '10:00') });

    const denied = await api().post('/api/v1/availability').set('Authorization', withoutPermission.auth).send(body(ownWithout.id));
    expect(denied.status).toBe(403);

    const otherProfessional = await api().post('/api/v1/availability').set('Authorization', withPermission.auth).send(body(ownWithout.id));
    expect(otherProfessional.status).toBe(403);

    const allowed = await api().post('/api/v1/availability').set('Authorization', withPermission.auth).send(body(ownWith.id));
    expect(allowed.status).toBe(201);
  });

  it('rechaza bloques superpuestos para el mismo profesional', async () => {
    const manager = await createUser('APPOINTMENT_MANAGER');
    const professional = await createProfessional([(await createSpecialty()).id]);
    const day = futureDay();
    await createBlock(professional.id, day, '09:00', '11:00');
    const res = await api()
      .post('/api/v1/availability')
      .set('Authorization', manager.auth)
      .send({ professionalId: professional.id, startAt: at(day, '10:00'), endAt: at(day, '12:00') });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AVAILABILITY_OVERLAP');
  });
});

describe('Horarios disponibles', () => {
  it('requiere sesión para consultar horarios disponibles', async () => {
    const res = await api().get('/api/v1/availability/slots');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('divide el bloque según la duración configurada', async () => {
    const patient = await createUser('PATIENT');
    const specialty = await createSpecialty();
    const professional = await createProfessional([specialty.id]);
    const day = futureDay();
    await createBlock(professional.id, day, '09:00', '10:00');

    const res = await api()
      .get(`/api/v1/availability/slots?date=${day}&specialtyId=${specialty.id}`)
      .set('Authorization', patient.auth);
    expect(res.status).toBe(200);
    expect(res.body.durationMinutes).toBe(15);
    expect(res.body.professionals[0].slots.map((slot: { startAt: string }) => slot.startAt)).toEqual([
      at(day, '09:00'),
      at(day, '09:15'),
      at(day, '09:30'),
      at(day, '09:45'),
    ]);
  });
});

describe('Modificación de disponibilidad', () => {
  async function blockWithAppointment() {
    const specialty = await createSpecialty();
    const professional = await createProfessional([specialty.id]);
    const day = futureDay();
    const block = await createBlock(professional.id, day, '09:00', '11:00');
    const patient = await createUser('PATIENT');
    const booked = await api()
      .post('/api/v1/appointments')
      .set('Authorization', patient.auth)
      .send({ professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '10:30') });
    expect(booked.status).toBe(201);
    return { block, day, manager: await createUser('APPOINTMENT_MANAGER') };
  }

  it('no permite desactivar un bloque con turnos confirmados', async () => {
    const { block, manager } = await blockWithAppointment();
    const res = await api().post(`/api/v1/availability/${block.id}/deactivate`).set('Authorization', manager.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AVAILABILITY_HAS_APPOINTMENTS');
  });

  it('no permite achicar un bloque dejando turnos afuera, pero sí si siguen adentro', async () => {
    const { block, day, manager } = await blockWithAppointment();
    const shrink = await api().patch(`/api/v1/availability/${block.id}`).set('Authorization', manager.auth).send({ endAt: at(day, '10:00') });
    expect(shrink.status).toBe(409);

    const ok = await api().patch(`/api/v1/availability/${block.id}`).set('Authorization', manager.auth).send({ startAt: at(day, '10:00') });
    expect(ok.status).toBe(200);
  });
});
