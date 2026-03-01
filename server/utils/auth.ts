import { prisma } from './prisma';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import { uuidv7 } from 'uuidv7';

// 21 days in ms
const SESSION_EXPIRY_MS = 21 * 24 * 60 * 60 * 1000;

export function useAuth() {
  const getSession = async (id: string) => {
    const session = await prisma.sessions.findUnique({
      where: { id },
    });

    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) return null;

    return session;
  };

  const getSessionAndBump = async (id: string) => {
    const session = await getSession(id);
    if (!session) return null;

    const now = new Date();
    const expiryDate = new Date(now.getTime() + SESSION_EXPIRY_MS);

    return await prisma.sessions.update({
      where: { id },
      data: {
        accessed_at: now,
        expires_at: expiryDate,
      },
    });
  };

  const makeSession = async (user: string, device: string, userAgent?: string) => {
    if (!userAgent) throw new Error('No useragent provided');

    const now = new Date();
    const expiryDate = new Date(now.getTime() + SESSION_EXPIRY_MS);

    // Atomic upsert — backed by @@unique([user, device]) in schema
    return await prisma.sessions.upsert({
      where: {
        user_device: { user, device },
      },
      update: {
        id: uuidv7(),
        user_agent: userAgent,
        created_at: now,
        accessed_at: now,
        expires_at: expiryDate,
      },
      create: {
        id: uuidv7(),
        user,
        device,
        user_agent: userAgent,
        created_at: now,
        accessed_at: now,
        expires_at: expiryDate,
      },
    });
  };

  const makeSessionToken = (session: { id: string }) => {
    const runtimeConfig = useRuntimeConfig();
    const cryptoSecret = runtimeConfig.cryptoSecret || process.env.CRYPTO_SECRET;

    if (!cryptoSecret) {
      console.error('CRYPTO_SECRET is missing from both runtime config and environment');
      console.error('Available runtime config keys:', Object.keys(runtimeConfig));
      console.error('Environment variables:', {
        CRYPTO_SECRET: process.env.CRYPTO_SECRET ? 'SET' : 'NOT SET',
        NODE_ENV: process.env.NODE_ENV,
      });
      throw new Error('CRYPTO_SECRET environment variable is not set');
    }

    return sign({ sid: session.id }, cryptoSecret, {
      algorithm: 'HS256',
    });
  };

  const verifySessionToken = (token: string) => {
    try {
      const runtimeConfig = useRuntimeConfig();
      const cryptoSecret = runtimeConfig.cryptoSecret || process.env.CRYPTO_SECRET;

      if (!cryptoSecret) {
        console.error('CRYPTO_SECRET is missing for token verification');
        return null;
      }

      const payload = verify(token, cryptoSecret, {
        algorithms: ['HS256'],
      });

      if (typeof payload === 'string') return null;
      return payload as { sid: string };
    } catch {
      return null;
    }
  };

  const getCurrentSession = async () => {
    const event = useEvent();
    const authHeader = getRequestHeader(event, 'authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifySessionToken(token);
    if (!payload) {
      throw createError({
        statusCode: 401,
        message: 'Invalid token',
      });
    }

    const session = await getSessionAndBump(payload.sid);
    if (!session) {
      throw createError({
        statusCode: 401,
        message: 'Session not found or expired',
      });
    }

    return session;
  };

  return {
    getSession,
    getSessionAndBump,
    makeSession,
    makeSessionToken,
    verifySessionToken,
    getCurrentSession,
  };
}
