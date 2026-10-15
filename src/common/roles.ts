import { Role } from '@prisma/client';

// Grupos de roles usados en las rutas. Centralizarlos evita errores de permisos.
export const ADMIN_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];
export const SCHEDULING_ROLES: Role[] = [Role.APPOINTMENT_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

export function isSchedulingStaff(role: Role): boolean {
  return SCHEDULING_ROLES.includes(role);
}
