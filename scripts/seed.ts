/**
 * Carga DATOS FICTICIOS para desarrollo y demostraciones.
 * Nunca se ejecuta en producción. Se puede correr varias veces.
 *
 *   npm run db:seed
 */
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) process.loadEnvFile('.env');

if (process.env.NODE_ENV === 'production') {
  console.error('El seed de demostración no se puede ejecutar en producción.');
  process.exit(1);
}

const prisma = new PrismaClient();

const specialties = [
  { name: 'Medicina General', description: 'Consultas generales y controles de salud.' },
  { name: 'Pediatría', description: 'Atención de niñas, niños y adolescentes.' },
  { name: 'Enfermería', description: 'Vacunación, curaciones y controles.' },
  { name: 'Odontología', description: 'Controles y tratamientos odontológicos.' },
  { name: 'Obstetricia', description: 'Controles durante el embarazo.' },
];

// Personas inventadas. Los emails usan el dominio reservado example.com.
const professionals = [
  { firstName: 'Lucía', lastName: 'Ferreyra', email: 'lucia.ferreyra@example.com', phone: '0000 000001', licenseNumber: 'MP-0001', specialties: ['Medicina General'] },
  { firstName: 'Martín', lastName: 'Gómez', email: 'martin.gomez@example.com', phone: '0000 000002', licenseNumber: 'MP-0002', specialties: ['Pediatría', 'Medicina General'] },
  { firstName: 'Sofía', lastName: 'Ibarra', email: 'sofia.ibarra@example.com', phone: '0000 000003', licenseNumber: null, specialties: ['Enfermería'] },
  { firstName: 'Diego', lastName: 'Ruiz', email: 'diego.ruiz@example.com', phone: '0000 000004', licenseNumber: 'MP-0004', specialties: ['Odontología'] },
  { firstName: 'Carla', lastName: 'Benítez', email: 'carla.benitez@example.com', phone: '0000 000005', licenseNumber: 'MP-0005', specialties: ['Obstetricia'] },
];

/** Próximos `count` días hábiles en formato YYYY-MM-DD (hora de Argentina). */
function nextWeekdays(count: number): string[] {
  const days: string[] = [];
  const cursor = new Date();
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(cursor);
    const weekDay = new Date(`${day}T12:00:00-03:00`).getUTCDay();
    if (weekDay !== 0 && weekDay !== 6) days.push(day);
  }
  return days;
}

async function main() {
  // Usuario técnico e inactivo que figura como creador de los datos de ejemplo.
  const seedUser = await prisma.user.upsert({
    where: { email: 'datos-demo@caps.invalid' },
    update: {},
    create: { email: 'datos-demo@caps.invalid', firstName: 'Datos', lastName: 'Demo', isActive: false },
  });

  for (const specialty of specialties) {
    await prisma.specialty.upsert({ where: { name: specialty.name }, update: {}, create: specialty });
  }

  const days = nextWeekdays(5);
  for (const { specialties: names, ...data } of professionals) {
    const linked = await prisma.specialty.findMany({ where: { name: { in: names } } });
    const professional = await prisma.professional.upsert({
      where: { email: data.email },
      update: {},
      create: {
        ...data,
        allowAvailabilityManagement: data.lastName === 'Ferreyra',
        specialties: { create: linked.map((specialty) => ({ specialtyId: specialty.id })) },
      },
    });

    for (const day of days) {
      const startAt = new Date(`${day}T08:00:00-03:00`);
      const endAt = new Date(`${day}T12:00:00-03:00`);
      const exists = await prisma.availability.findFirst({
        where: { professionalId: professional.id, startAt: { lt: endAt }, endAt: { gt: startAt } },
      });
      if (!exists) {
        await prisma.availability.create({
          data: { professionalId: professional.id, startAt, endAt, createdByUserId: seedUser.id },
        });
      }
    }
  }

  console.log(`Datos de demostración cargados: ${specialties.length} especialidades, ${professionals.length} profesionales, disponibilidad para ${days.join(', ')} de 08:00 a 12:00.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
