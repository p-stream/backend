import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';

const startSchema = z.object({
  publicKey: z.string(),
});

export default defineEventHandler(async event => {
  const body = await readBody(event);

  const result = startSchema.safeParse(body);
  if (!result.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
    });
  }

  const user = await prisma.users.findUnique({
    where: { public_key: body.publicKey },
    select: { id: true },
  });

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'User cannot be found',
    });
  }

  const challenge = useChallenge();
  const challengeCode = await challenge.createChallengeCode('login', 'mnemonic');

  return {
    challenge: challengeCode.code,
  };
});
