import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { APP_TIME_ZONE } from './config/time';
import { errorHandler, notFoundHandler } from './common/errors';
import { createAuthenticate } from './auth/auth.middleware';
import type { TokenVerifier } from './auth/token-verifier';
import { createAuthRouter } from './auth/auth.routes';
import { createUsersRouter } from './users/users.routes';
import { createSpecialtiesRouter } from './specialties/specialties.routes';
import { createProfessionalsRouter } from './professionals/professionals.routes';
import { createAvailabilityRouter } from './availability/availability.routes';
import { createAppointmentsRouter } from './appointments/appointments.routes';

/**
 * Arma la aplicación Express. Recibe el verificador de tokens como parámetro
 * para poder usar uno falso en los tests.
 */
export function createApp({ verifyToken }: { verifyToken: TokenVerifier }) {
  const app = express();
  const authenticate = createAuthenticate(verifyToken);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '50kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Configuración pública que necesita el frontend (así no se duplican reglas).
  api.get('/config', (_req, res) => {
    res.json({ appointmentDurationMinutes: env.APPOINTMENT_DURATION_MINUTES, timeZone: APP_TIME_ZONE });
  });
  api.use('/auth', createAuthRouter(authenticate));
  api.use('/users', createUsersRouter(authenticate));
  api.use('/specialties', createSpecialtiesRouter(authenticate));
  api.use('/professionals', createProfessionalsRouter(authenticate));
  api.use('/availability', createAvailabilityRouter(authenticate));
  api.use('/appointments', createAppointmentsRouter(authenticate));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
