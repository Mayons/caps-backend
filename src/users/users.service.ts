import { Prisma, type Role, type User } from '@prisma/client';
import { prisma } from '../common/prisma';
import { conflict, forbidden, isUniqueViolation, notFound } from '../common/errors';
import { paginated, toPrismaPagination, type Pagination } from '../common/pagination';
import { professionalLinkSelect, toUserProfile } from '../auth/auth.service';

/**
 * Roles administrativos asignables desde la API según la jerarquía del actor.
 * - SUPER_ADMIN nunca se asigna por la API (solo con el script del servidor).
 * - PROFESSIONAL solo se obtiene aceptando una invitación.
 */
export const ASSIGNABLE_ROLES = ['PATIENT', 'APPOINTMENT_MANAGER', 'ADMIN'] as const satisfies readonly Role[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export async function createUser(actor: User, input: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: AssignableRole;
}) {
  if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) || (actor.role !== 'SUPER_ADMIN' && input.role === 'ADMIN')) {
    throw forbidden('FORBIDDEN', 'No tenés permiso para asignar ese rol');
  }
  try {
    const user = await prisma.user.create({ data: input });
    return toUserProfile(user);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('EMAIL_IN_USE', 'Ya existe un usuario con ese email');
    throw error;
  }
}

export async function listUsers(
  filters: { search?: string; role?: Role },
  pagination: Pagination,
) {
  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.search
      ? {
          OR: [
            { email: { contains: filters.search, mode: 'insensitive' } },
            { firstName: { contains: filters.search, mode: 'insensitive' } },
            { lastName: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: { professional: { select: professionalLinkSelect } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...toPrismaPagination(pagination),
    }),
    prisma.user.count({ where }),
  ]);
  return paginated(items.map(toUserProfile), total, pagination);
}

async function findTarget(tx: Prisma.TransactionClient, actor: User, targetId: string) {
  if (actor.id === targetId) {
    throw forbidden('CANNOT_MODIFY_SELF', 'No podés modificar tu propio rol ni tu propio acceso');
  }
  const target = await tx.user.findUnique({ where: { id: targetId } });
  if (!target) throw notFound('Usuario no encontrado');
  return target;
}

export async function changeRole(actor: User, targetId: string, role: AssignableRole) {
  if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) || (actor.role !== 'SUPER_ADMIN' && role === 'ADMIN')) {
    throw forbidden('FORBIDDEN', 'Solo un Super Admin puede asignar administradores');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const target = await findTarget(tx, actor, targetId);
    if (actor.role !== 'SUPER_ADMIN' && target.role === 'ADMIN') {
      throw forbidden('FORBIDDEN', 'Solo un Super Admin puede modificar administradores');
    }
    if (target.role === 'SUPER_ADMIN') {
      throw forbidden('CANNOT_MODIFY_SUPER_ADMIN', 'El rol de un Super Admin no se modifica desde la aplicación');
    }
    if (target.role === 'PROFESSIONAL') {
      throw conflict(
        'USER_IS_PROFESSIONAL',
        'Esta cuenta está vinculada a un profesional. Revocá el acceso del profesional primero',
      );
    }
    return tx.user.update({
      where: { id: targetId },
      data: { role },
      include: { professional: { select: professionalLinkSelect } },
    });
  });
  return toUserProfile(updated);
}

export async function changeStatus(actor: User, targetId: string, isActive: boolean) {
  if (actor.role !== 'SUPER_ADMIN') {
    throw forbidden('FORBIDDEN', 'Solo un Super Admin puede restringir accesos');
  }
  const updated = await prisma.$transaction(async (tx) => {
    // Bloqueo para que dos desactivaciones simultáneas no dejen el sistema sin Super Admin.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('caps:super-admin-guard'))`;

    const target = await findTarget(tx, actor, targetId);
    if (target.role === 'SUPER_ADMIN' && !isActive) {
      const otherActiveSuperAdmins = await tx.user.count({
        where: { role: 'SUPER_ADMIN', isActive: true, id: { not: targetId } },
      });
      if (otherActiveSuperAdmins === 0) {
        throw conflict('LAST_SUPER_ADMIN', 'No se puede desactivar al último Super Admin');
      }
    }
    return tx.user.update({
      where: { id: targetId },
      data: { isActive },
      include: { professional: { select: professionalLinkSelect } },
    });
  });
  return toUserProfile(updated);
}

export async function deleteUser(actor: User, targetId: string) {
  if (actor.role !== 'SUPER_ADMIN') throw forbidden('FORBIDDEN', 'Solo un Super Admin puede eliminar usuarios');
  try {
    await prisma.$transaction(async (tx) => {
      const target = await findTarget(tx, actor, targetId);
      if (target.role === 'SUPER_ADMIN') {
        throw forbidden('CANNOT_MODIFY_SUPER_ADMIN', 'No se puede eliminar un Super Admin desde la aplicación');
      }
      if (await tx.professional.count({ where: { userId: targetId } })) {
        throw conflict('USER_HAS_RECORDS', 'Esta cuenta tiene una ficha profesional. Restringí su acceso en lugar de eliminarla');
      }
      await tx.user.delete({ where: { id: targetId } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw conflict('USER_HAS_RECORDS', 'El usuario tiene registros vinculados. Restringí su acceso en lugar de eliminarlo');
    }
    throw error;
  }
}
