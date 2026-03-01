import { useAuth } from '~/utils/auth';
import { z } from 'zod';

const updateSessionSchema = z.object({
  deviceName: z.string().max(500).min(1).optional(),
});

export default defineEventHandler(async event => {
  const sessionId = getRouterParam(event, 'sid');

  const currentSession = await useAuth().getCurrentSession();

  const targetedSession = await prisma.sessions.findUnique({
    where: { id: sessionId },
  });

  if (!targetedSession) {
    if (event.method === 'DELETE') {
      return { id: sessionId };
    }

    throw createError({
      statusCode: 404,
      message: 'Session cannot be found',
    });
  }

  if (targetedSession.user !== currentSession.user) {
    throw createError({
      statusCode: 401,
      message:
        event.method === 'DELETE'
          ? 'Cannot delete sessions you do not own'
          : 'Cannot edit sessions other than your own',
    });
  }

  if (event.method === 'PATCH') {
    const body = await readBody(event);
    const validatedBody = updateSessionSchema.parse(body);

    // Use update return value directly — no redundant findUnique
    let updatedSession;
    try {
      updatedSession = validatedBody.deviceName
        ? await prisma.sessions.update({
            where: { id: sessionId },
            data: { device: validatedBody.deviceName },
          })
        : targetedSession;
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw createError({
          statusCode: 409,
          message: 'A session with this device name already exists',
        });
      }
      throw err;
    }

    return {
      id: updatedSession.id,
      user: updatedSession.user,
      createdAt: updatedSession.created_at,
      accessedAt: updatedSession.accessed_at,
      expiresAt: updatedSession.expires_at,
      device: updatedSession.device,
      userAgent: updatedSession.user_agent,
      current: updatedSession.id === currentSession.id,
    };
  }

  if (event.method === 'DELETE') {
    // targetedSession already validated above — no redundant findUnique or session bump needed
    await prisma.sessions.delete({
      where: { id: sessionId },
    });

    return { id: sessionId };
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
