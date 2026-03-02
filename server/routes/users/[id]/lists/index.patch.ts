import { useAuth } from '#imports';
import { z } from 'zod';
import { prisma } from '#imports';
import { uuidv7 } from 'uuidv7';

const listItemSchema = z.object({
  tmdb_id: z.string(),
  type: z.enum(['movie', 'tv']),
});

const updateListSchema = z.object({
  list_id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(255).optional().nullable(),
  public: z.boolean().optional(),
  addItems: z.array(listItemSchema).optional(),
  removeItems: z.array(listItemSchema).optional(),
});

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const session = await useAuth().getCurrentSession();

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot modify lists for other users',
    });
  }

  const body = await readBody(event);
  const validatedBody = updateListSchema.parse(body);

  const list = await prisma.lists.findUnique({
    relationLoadStrategy: 'join',
    where: { id: validatedBody.list_id },
    include: { list_items: true },
  });

  if (!list) {
    throw createError({
      statusCode: 404,
      message: 'List not found',
    });
  }

  if (list.user_id !== userId) {
    throw createError({
      statusCode: 403,
      message: "Cannot modify lists you don't own",
    });
  }

  let result;
  try {
    result = await prisma.$transaction(async tx => {
    if (
      validatedBody.name ||
      validatedBody.description !== undefined ||
      validatedBody.public !== undefined
    ) {
      await tx.lists.update({
        where: { id: list.id },
        data: {
          name: validatedBody.name ?? list.name,
          description:
            validatedBody.description !== undefined ? validatedBody.description : list.description,
          public: validatedBody.public ?? list.public,
          updated_at: new Date(),
        },
      });
    }

    if (validatedBody.addItems && validatedBody.addItems.length > 0) {
      const existingTmdbIds = list.list_items.map(item => item.tmdb_id);

      const itemsToAdd = validatedBody.addItems.filter(
        item => !existingTmdbIds.includes(item.tmdb_id)
      );

      if (itemsToAdd.length > 0) {
        await tx.list_items.createMany({
          data: itemsToAdd.map(item => ({
            id: uuidv7(),
            list_id: list.id,
            tmdb_id: item.tmdb_id,
            type: item.type,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (validatedBody.removeItems && validatedBody.removeItems.length > 0) {
      const tmdbIdsToRemove = validatedBody.removeItems.map(item => item.tmdb_id);

      await tx.list_items.deleteMany({
        where: {
          list_id: list.id,
          tmdb_id: { in: tmdbIdsToRemove },
        },
      });
    }

    return tx.lists.findUnique({
      relationLoadStrategy: 'join',
      where: { id: list.id },
      include: { list_items: true },
    });
  });
  } catch (err: any) {
    if (err.code === 'P2002') {
      throw createError({ statusCode: 409, message: 'A list with this name already exists' });
    }
    throw err;
  }

  return {
    list: result,
    message: 'List updated successfully',
  };
});
