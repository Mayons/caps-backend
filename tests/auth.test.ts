import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/common/prisma';
import { createFirebaseTokenVerifier } from '../src/auth/token-verifier';
import { api, createUser, resetDatabase, tokenFor } from './helpers';

beforeEach(resetDatabase);

describe('Verificación de tokens', () => {
  it('rechaza pedidos sin token', async () => {
    const res = await api().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rechaza tokens inválidos', async () => {
    const res = await api().get('/api/v1/auth/me').set('Authorization', 'Bearer cualquier-cosa');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('el verificador real de Firebase rechaza un token mal formado', async () => {
    const verify = createFirebaseTokenVerifier('caps-test');
    await expect(verify('esto-no-es-un-jwt')).rejects.toThrow();
  });
});

describe('Registro de pacientes', () => {
  it('crea un usuario PATIENT con el email del token, normalizado', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', tokenFor('nuevo-uid', 'Ana.Perez@Example.com'))
      .send({ firstName: 'Ana', lastName: 'Pérez', phone: '0000 123456' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('PATIENT');
    expect(res.body.email).toBe('ana.perez@example.com');
    expect(res.body).not.toHaveProperty('firebaseUid');
  });

  it('no permite elegir el rol desde el formulario', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', tokenFor('uid-x', 'x@example.com'))
      .send({ firstName: 'X', lastName: 'Y', role: 'SUPER_ADMIN' });

    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('no permite registrarse dos veces', async () => {
    const { auth } = await createUser();
    const res = await api().post('/api/v1/auth/register').set('Authorization', auth).send({ firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(409);
  });

  it('indica cuando la identidad todavía no completó el registro', async () => {
    const res = await api().get('/api/v1/auth/me').set('Authorization', tokenFor('sin-registro', 'z@example.com'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_NOT_REGISTERED');
  });
});

describe('Usuarios inactivos', () => {
  it('rechaza a usuarios desactivados aunque el token sea válido', async () => {
    const { auth } = await createUser('ADMIN', { isActive: false });
    const res = await api().get('/api/v1/auth/me').set('Authorization', auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });
});

describe('Activación de usuarios dados de alta por administración', () => {
  it('vincula un perfil pendiente solo con un email verificado y conserva su rol', async () => {
    const pending = await prisma.user.create({
      data: { email: 'gestor@example.com', firstName: 'Gestor', lastName: 'Nuevo', role: 'APPOINTMENT_MANAGER' },
    });
    const unverified = await api().get('/api/v1/auth/me')
      .set('Authorization', tokenFor('uid-gestor', 'gestor@example.com', false));
    expect(unverified.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).firebaseUid).toBeNull();
    const verified = await api().get('/api/v1/auth/me')
      .set('Authorization', tokenFor('uid-gestor', 'Gestor@Example.com'));
    expect(verified.status).toBe(200);
    expect(verified.body.id).toBe(pending.id);
    expect(verified.body.role).toBe('APPOINTMENT_MANAGER');
    const otherIdentity = await api().get('/api/v1/auth/me')
      .set('Authorization', tokenFor('otro-uid', 'gestor@example.com'));
    expect(otherIdentity.status).toBe(403);
  });

  it('no activa perfiles restringidos', async () => {
    const pending = await prisma.user.create({
      data: { email: 'inactivo@example.com', firstName: 'Usuario', lastName: 'Inactivo', isActive: false },
    });
    const res = await api().get('/api/v1/auth/me')
      .set('Authorization', tokenFor('uid-inactivo', pending.email));
    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).firebaseUid).toBeNull();
  });
});
