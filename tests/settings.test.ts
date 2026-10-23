import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/common/prisma';
import { api, createUser, resetDatabase, tokenFor } from './helpers';

beforeEach(resetDatabase);

async function setFlags(flags: { adminOnlyLogin?: boolean; registrationClosed?: boolean }) {
  const { auth } = await createUser('ADMIN');
  const res = await api().patch('/api/v1/settings').set('Authorization', auth).send(flags);
  expect(res.status).toBe(200);
  return res.body;
}

describe('Configuración del sistema', () => {
  it('por defecto deja ingresar y registrarse a cualquiera', async () => {
    const res = await api().get('/api/v1/config');
    expect(res.body).toMatchObject({ adminOnlyLogin: false, registrationClosed: false });
  });

  it('solo administradores pueden ver y cambiar la configuración', async () => {
    const { auth } = await createUser('APPOINTMENT_MANAGER');
    expect((await api().get('/api/v1/settings').set('Authorization', auth)).status).toBe(403);
    expect((await api().patch('/api/v1/settings').set('Authorization', auth).send({ adminOnlyLogin: true })).status).toBe(403);
  });

  it('rechaza campos desconocidos', async () => {
    const { auth } = await createUser('SUPER_ADMIN');
    const res = await api().patch('/api/v1/settings').set('Authorization', auth).send({ maintenance: true });
    expect(res.status).toBe(400);
  });

  it('expone los cambios en la configuración pública', async () => {
    const body = await setFlags({ registrationClosed: true });
    expect(body).toMatchObject({ adminOnlyLogin: false, registrationClosed: true });
    const res = await api().get('/api/v1/config');
    expect(res.body).toMatchObject({ adminOnlyLogin: false, registrationClosed: true });
  });
});

describe('Ingreso solo para administradores', () => {
  beforeEach(() => setFlags({ adminOnlyLogin: true }));

  it.each(['PATIENT', 'PROFESSIONAL', 'APPOINTMENT_MANAGER'] as const)('rechaza a usuarios %s', async (role) => {
    const { auth } = await createUser(role);
    const res = await api().get('/api/v1/auth/me').set('Authorization', auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_ONLY_LOGIN');
  });

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('deja ingresar a %s', async (role) => {
    const { auth } = await createUser(role);
    const res = await api().get('/api/v1/auth/me').set('Authorization', auth);
    expect(res.status).toBe(200);
  });

  it('no permite registrarse', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', tokenFor('uid-nuevo', 'nuevo@example.com'))
      .send({ firstName: 'Ana', lastName: 'Pérez' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_ONLY_LOGIN');
    expect(await prisma.user.count({ where: { email: 'nuevo@example.com' } })).toBe(0);
  });

  it('deja ingresar a un administrador dado de alta que entra por primera vez', async () => {
    await prisma.user.create({ data: { email: 'admin.nuevo@example.com', firstName: 'A', lastName: 'B', role: 'ADMIN' } });
    const res = await api().get('/api/v1/auth/me').set('Authorization', tokenFor('uid-admin', 'admin.nuevo@example.com'));
    expect(res.status).toBe(200);
  });
});

describe('Registro cerrado', () => {
  beforeEach(() => setFlags({ registrationClosed: true }));

  it('rechaza a quien no está dado de alta en CAPS', async () => {
    const res = await api().get('/api/v1/auth/me').set('Authorization', tokenFor('uid-desconocido', 'x@example.com'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
  });

  it('no permite registrarse', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', tokenFor('uid-nuevo', 'nuevo@example.com'))
      .send({ firstName: 'Ana', lastName: 'Pérez' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    expect(await prisma.user.count()).toBe(1);
  });

  it('deja ingresar a usuarios ya registrados', async () => {
    const { auth } = await createUser('PATIENT');
    expect((await api().get('/api/v1/auth/me').set('Authorization', auth)).status).toBe(200);
  });

  it('deja ingresar a usuarios dados de alta por administración', async () => {
    await prisma.user.create({ data: { email: 'gestor@example.com', firstName: 'G', lastName: 'N', role: 'APPOINTMENT_MANAGER' } });
    const res = await api().get('/api/v1/auth/me').set('Authorization', tokenFor('uid-gestor', 'gestor@example.com'));
    expect(res.status).toBe(200);
  });
});
