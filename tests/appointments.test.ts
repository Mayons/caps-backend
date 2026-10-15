import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/common/prisma';
import { api, at, createBlock, createProfessional, createSpecialty, createUser, futureDay, resetDatabase } from './helpers';

beforeEach(resetDatabase);

async function scenario() {
  const specialty = await createSpecialty('Clínica');
  const otherSpecialty = await createSpecialty('Odontología');
  const professional = await createProfessional([specialty.id]);
  const day = futureDay();
  await createBlock(professional.id, day, '09:00', '11:00');
  const patient = await createUser('PATIENT');
  return { specialty, otherSpecialty, professional, day, patient };
}

function book(auth: string, body: object) {
  return api().post('/api/v1/appointments').set('Authorization', auth).send(body);
}

describe('Reserva de turnos', () => {
  it('reserva un horario disponible y devuelve el identificador', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const res = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:15') });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.endAt).toBe(at(day, '09:30'));

    // El horario deja de aparecer como disponible.
    const slots = await api()
      .get(`/api/v1/availability/slots?date=${day}&professionalId=${professional.id}`)
      .set('Authorization', patient.auth);
    expect(slots.status).toBe(200);
    const starts = slots.body.professionals[0].slots.map((slot: { startAt: string }) => slot.startAt);
    expect(starts).not.toContain(at(day, '09:15'));
  });

  it('valida que la especialidad corresponda al profesional', async () => {
    const { otherSpecialty, professional, day, patient } = await scenario();
    const res = await book(patient.auth, { professionalId: professional.id, specialtyId: otherSpecialty.id, startAt: at(day, '09:00') });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SPECIALTY_MISMATCH');
  });

  it('rechaza horarios fuera de la disponibilidad o desalineados', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const outside = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '14:00') });
    expect(outside.status).toBe(409);
    const misaligned = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:07') });
    expect(misaligned.status).toBe(409);
    const lastPartial = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '10:50') });
    expect(lastPartial.status).toBe(409);
  });

  it('rechaza turnos en el pasado', async () => {
    const { specialty, professional, patient } = await scenario();
    const res = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: new Date(Date.now() - 60_000).toISOString() });
    expect(res.status).toBe(400);
  });

  it('evita dobles reservas incluso con pedidos simultáneos', async () => {
    const { specialty, professional, day } = await scenario();
    const patients = await Promise.all([1, 2, 3, 4, 5].map(() => createUser('PATIENT')));
    const body = { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '10:00') };

    const results = await Promise.all(patients.map((patient) => book(patient.auth, body)));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.appointment.count({ where: { status: 'CONFIRMED' } })).toBe(1);
  });

  it('solo los pacientes pueden reservar', async () => {
    const { specialty, professional, day } = await scenario();
    const admin = await createUser('ADMIN');
    const res = await book(admin.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });
    expect(res.status).toBe(403);
  });
});

describe('Acceso de pacientes únicamente a sus turnos', () => {
  it('otro paciente no puede ver, editar ni cancelar el turno', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const booked = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });
    const intruder = await createUser('PATIENT');

    const view = await api().get(`/api/v1/appointments/${booked.body.id}`).set('Authorization', intruder.auth);
    expect(view.status).toBe(404);
    const edit = await api().patch(`/api/v1/appointments/${booked.body.id}`).set('Authorization', intruder.auth).send({ startAt: at(day, '09:30') });
    expect(edit.status).toBe(404);
    const cancel = await api().post(`/api/v1/appointments/${booked.body.id}/cancel`).set('Authorization', intruder.auth);
    expect(cancel.status).toBe(404);

    const mine = await api().get('/api/v1/appointments/mine').set('Authorization', intruder.auth);
    expect(mine.body.total).toBe(0);
  });
});

describe('Edición y cancelación de turnos', () => {
  it('el paciente reprograma su turno y el horario anterior queda libre', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const booked = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });

    const res = await api().patch(`/api/v1/appointments/${booked.body.id}`).set('Authorization', patient.auth).send({ startAt: at(day, '09:45') });
    expect(res.status).toBe(200);
    expect(res.body.startAt).toBe(at(day, '09:45'));

    const other = await createUser('PATIENT');
    const reuse = await book(other.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });
    expect(reuse.status).toBe(201);
  });

  it('no permite reprogramar a un horario ocupado', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const other = await createUser('PATIENT');
    await book(other.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:30') });
    const booked = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });

    const res = await api().patch(`/api/v1/appointments/${booked.body.id}`).set('Authorization', patient.auth).send({ startAt: at(day, '09:30') });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_TAKEN');
  });

  it('cancela conservando el registro y luego no permite editarlo', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const booked = await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });

    const cancel = await api().post(`/api/v1/appointments/${booked.body.id}/cancel`).set('Authorization', patient.auth);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(await prisma.appointment.count({ where: { id: booked.body.id } })).toBe(1);

    const edit = await api().patch(`/api/v1/appointments/${booked.body.id}`).set('Authorization', patient.auth).send({ startAt: at(day, '09:30') });
    expect(edit.status).toBe(409);
  });
});

describe('Acceso de profesionales únicamente a su agenda', () => {
  it('ve sus turnos con datos mínimos del paciente y no los de otros', async () => {
    const { specialty, professional, day, patient } = await scenario();
    const account = await createUser('PROFESSIONAL');
    await prisma.professional.update({ where: { id: professional.id }, data: { userId: account.user.id } });
    const colleague = await createProfessional([specialty.id]);
    await createBlock(colleague.id, day, '09:00', '10:00');

    await book(patient.auth, { professionalId: professional.id, specialtyId: specialty.id, startAt: at(day, '09:00') });
    const otherPatient = await createUser('PATIENT');
    const foreign = await book(otherPatient.auth, { professionalId: colleague.id, specialtyId: specialty.id, startAt: at(day, '09:15') });

    const agenda = await api().get(`/api/v1/appointments/agenda?date=${day}`).set('Authorization', account.auth);
    expect(agenda.status).toBe(200);
    expect(agenda.body.confirmedForDate).toBe(1);
    expect(agenda.body.appointments[0].patient).not.toHaveProperty('email');

    const foreignView = await api().get(`/api/v1/appointments/${foreign.body.id}`).set('Authorization', account.auth);
    expect(foreignView.status).toBe(404);

    const allAppointments = await api().get('/api/v1/appointments').set('Authorization', account.auth);
    expect(allAppointments.status).toBe(403);

    const otherBlocks = await api().get(`/api/v1/availability?professionalId=${colleague.id}`).set('Authorization', account.auth);
    expect(otherBlocks.status).toBe(403);
  });
});
