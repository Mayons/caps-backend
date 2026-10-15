import type { Specialty } from '@prisma/client';
import { prisma } from '../common/prisma';
import { conflict, isConstraintError, isUniqueViolation, notFound } from '../common/errors';

export function toSpecialtyResponse(specialty: Specialty) {
  return {
    id: specialty.id,
    name: specialty.name,
    description: specialty.description,
    isActive: specialty.isActive,
  };
}

export async function listSpecialties({ includeInactive }: { includeInactive: boolean }) {
  const specialties = await prisma.specialty.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' },
  });
  return specialties.map(toSpecialtyResponse);
}

interface SpecialtyInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

function handleDuplicateName(error: unknown): never {
  if (isUniqueViolation(error) || isConstraintError(error, 'Specialty_name_lower_key')) {
    throw conflict('SPECIALTY_NAME_TAKEN', 'Ya existe una especialidad con ese nombre');
  }
  throw error;
}

export async function createSpecialty(input: SpecialtyInput) {
  try {
    return toSpecialtyResponse(await prisma.specialty.create({ data: input }));
  } catch (error) {
    handleDuplicateName(error);
  }
}

export async function updateSpecialty(id: string, input: Partial<SpecialtyInput>) {
  const existing = await prisma.specialty.findUnique({ where: { id } });
  if (!existing) throw notFound('Especialidad no encontrada');
  try {
    return toSpecialtyResponse(await prisma.specialty.update({ where: { id }, data: input }));
  } catch (error) {
    handleDuplicateName(error);
  }
}
