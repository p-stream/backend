import { useAuth } from '~/utils/auth';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';

function progressIsNotStarted(duration: number, watched: number): boolean {
  // too short watch time
  if (watched < 20) return true;
  return false;
}

function progressIsCompleted(duration: number, watched: number): boolean {
  const timeFromEnd = duration - watched;
  // too close to the end, is completed
  if (timeFromEnd < 60 * 2) return true;
  return false;
}

async function shouldSaveProgress(
  userId: string,
  tmdbId: string,
  validatedBody: any,
  prisma: any
): Promise<boolean> {
  const duration = parseInt(validatedBody.duration);
  const watched = parseInt(validatedBody.watched);

  // Check if progress is acceptable
  const isNotStarted = progressIsNotStarted(duration, watched);
  const isCompleted = progressIsCompleted(duration, watched);
  const isAcceptable = !isNotStarted && !isCompleted;

  // For movies, only save if acceptable
  if (validatedBody.meta.type === 'movie') {
    return isAcceptable;
  }

  // For shows, save if acceptable OR if season has other watched episodes
  if (isAcceptable) return true;

  // Check if this season has other episodes with progress
  if (!validatedBody.seasonId) return false;

  const seasonEpisodes = await prisma.progress_items.findMany({
    where: {
      user_id: userId,
      tmdb_id: tmdbId,
      season_id: validatedBody.seasonId,
      episode_id: {
        not: validatedBody.episodeId || null
      }
    }
  });

  // Check if any other episode in this season has acceptable progress
  return seasonEpisodes.some((episode: any) => {
    const epDuration = Number(episode.duration);
    const epWatched = Number(episode.watched);
    return !progressIsNotStarted(epDuration, epWatched) &&
      !progressIsCompleted(epDuration, epWatched);
  });
}

const progressMetaSchema = z.object({
  title: z.string(),
  year: z.number().optional(),
  poster: z.string().optional(),
  type: z.enum(['movie', 'show']),
});

const progressItemSchema = z.object({
  meta: progressMetaSchema,
  tmdbId: z.string(),
  duration: z.number().transform(n => n.toString()),
  watched: z.number().transform(n => n.toString()),
  seasonId: z.string().optional(),
  episodeId: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

// 13th July 2021 - movie-web epoch
const minEpoch = 1626134400000;

function defaultAndCoerceDateTime(dateTime: string | undefined) {
  const epoch = dateTime ? new Date(dateTime).getTime() : Date.now();
  const clampedEpoch = Math.max(minEpoch, Math.min(epoch, Date.now()));
  return new Date(clampedEpoch);
}

export default defineEventHandler(async event => {
  const userId = event.context.params?.id;
  const method = event.method;

  const session = await useAuth().getCurrentSession();
  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Session not found or expired',
    });
  }

  if (session.user !== userId) {
    throw createError({
      statusCode: 403,
      message: 'Cannot access other user information',
    });
  }

  if (method === 'GET') {
    const items = await prisma.progress_items.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        tmdb_id: true,
        episode_id: true,
        episode_number: true,
        season_id: true,
        season_number: true,
        meta: true,
        duration: true,
        watched: true,
        updated_at: true,
      },
    });

    return items.map(item => ({
      id: item.id,
      tmdbId: item.tmdb_id,
      episode: {
        id: item.episode_id === '\n' ? null : item.episode_id || null,
        number: item.episode_number || null,
      },
      season: {
        id: item.season_id === '\n' ? null : item.season_id || null,
        number: item.season_number || null,
      },
      meta: item.meta,
      duration: item.duration.toString(),
      watched: item.watched.toString(),
      updatedAt: item.updated_at.toISOString(),
    }));
  }

  if (method === 'DELETE' && event.path.endsWith('/progress/cleanup')) {
    // Clean up unwanted progress items (unwatched or finished)
    const allItems = await prisma.progress_items.findMany({
      where: { user_id: userId },
    });

    const itemsToDelete: string[] = [];

    // Group items by tmdbId for show processing
    const itemsByTmdbId: Record<string, any[]> = {};
    for (const item of allItems) {
      if (!itemsByTmdbId[item.tmdb_id]) {
        itemsByTmdbId[item.tmdb_id] = [];
      }
      itemsByTmdbId[item.tmdb_id].push(item);
    }

    for (const [tmdbId, items] of Object.entries(itemsByTmdbId)) {
      const movieItems = items.filter(item => !item.episode_id || item.episode_id === '\n');
      const episodeItems = items.filter(item => item.episode_id && item.episode_id !== '\n');

      // Process movies
      for (const item of movieItems) {
        const duration = Number(item.duration);
        const watched = Number(item.watched);
        const isNotStarted = progressIsNotStarted(duration, watched);
        const isCompleted = progressIsCompleted(duration, watched);

        if (isNotStarted || isCompleted) {
          itemsToDelete.push(item.id);
        }
      }

      // Process episodes - group by season
      const episodesBySeason: Record<string, any[]> = {};
      for (const item of episodeItems) {
        const seasonKey = `${item.season_id}`;
        if (!episodesBySeason[seasonKey]) {
          episodesBySeason[seasonKey] = [];
        }
        episodesBySeason[seasonKey].push(item);
      }

      for (const seasonItems of Object.values(episodesBySeason)) {
        // Check if season has any acceptable episodes
        const hasAcceptableEpisodes = seasonItems.some((item: any) => {
          const duration = Number(item.duration);
          const watched = Number(item.watched);
          return !progressIsNotStarted(duration, watched) &&
            !progressIsCompleted(duration, watched);
        });

        if (hasAcceptableEpisodes) {
          // If season has acceptable episodes, only delete unacceptable ones
          for (const item of seasonItems) {
            const duration = Number(item.duration);
            const watched = Number(item.watched);
            const isNotStarted = progressIsNotStarted(duration, watched);
            const isCompleted = progressIsCompleted(duration, watched);

            if (isNotStarted || isCompleted) {
              itemsToDelete.push(item.id);
            }
          }
        } else {
          // If no acceptable episodes in season, delete all
          itemsToDelete.push(...seasonItems.map((item: any) => item.id));
        }
      }
    }

    if (itemsToDelete.length > 0) {
      await prisma.progress_items.deleteMany({
        where: {
          id: { in: itemsToDelete },
          user_id: userId,
        },
      });
    }

    return {
      deletedCount: itemsToDelete.length,
      message: `Cleaned up ${itemsToDelete.length} unwanted progress items`,
    };
  }

  if (event.path.includes('/progress/') && !event.path.endsWith('/import') && !event.path.endsWith('/cleanup')) {
    const segments = event.path.split('/');
    const tmdbId = segments[segments.length - 1];

    if (method === 'PUT') {
      const body = await readBody(event);
      const validatedBody = progressItemSchema.parse(body);

      // Check if this progress should be saved
      const shouldSave = await shouldSaveProgress(userId, tmdbId, validatedBody, prisma);
      if (!shouldSave) {
        // Return early without saving
        return {
          id: '',
          tmdbId,
          userId,
          seasonId: validatedBody.seasonId,
          episodeId: validatedBody.episodeId,
          seasonNumber: validatedBody.seasonNumber,
          episodeNumber: validatedBody.episodeNumber,
          meta: validatedBody.meta,
          duration: parseInt(validatedBody.duration),
          watched: parseInt(validatedBody.watched),
          updatedAt: defaultAndCoerceDateTime(validatedBody.updatedAt),
        };
      }

      const now = defaultAndCoerceDateTime(validatedBody.updatedAt);

      const progressItem = await prisma.progress_items.upsert({
        where: {
          tmdb_id_user_id_season_id_episode_id: {
            tmdb_id: tmdbId,
            user_id: userId,
            season_id: validatedBody.meta.type === 'movie' ? '\n' : validatedBody.seasonId || null,
            episode_id: validatedBody.meta.type === 'movie' ? '\n' : validatedBody.episodeId || null,
          },
        },
        update: {
          duration: BigInt(validatedBody.duration),
          watched: BigInt(validatedBody.watched),
          meta: validatedBody.meta,
          updated_at: now,
        },
        create: {
          id: uuidv7(),
          tmdb_id: tmdbId,
          user_id: userId,
          season_id: validatedBody.meta.type === 'movie' ? '\n' : validatedBody.seasonId || null,
          episode_id: validatedBody.meta.type === 'movie' ? '\n' : validatedBody.episodeId || null,
          season_number: validatedBody.seasonNumber || null,
          episode_number: validatedBody.episodeNumber || null,
          duration: BigInt(validatedBody.duration),
          watched: BigInt(validatedBody.watched),
          meta: validatedBody.meta,
          updated_at: now,
        },
      });

      return {
        id: progressItem.id,
        tmdbId: progressItem.tmdb_id,
        userId: progressItem.user_id,
        seasonId: progressItem.season_id === '\n' ? null : progressItem.season_id,
        episodeId: progressItem.episode_id === '\n' ? null : progressItem.episode_id,
        seasonNumber: progressItem.season_number,
        episodeNumber: progressItem.episode_number,
        meta: progressItem.meta,
        duration: Number(progressItem.duration),
        watched: Number(progressItem.watched),
        updatedAt: progressItem.updated_at,
      };
    }

    if (method === 'DELETE') {
      const body = await readBody(event).catch(() => ({}));

      const whereClause: any = {
        user_id: userId,
        tmdb_id: tmdbId,
      };

      if (body.seasonId) whereClause.season_id = body.seasonId;
      if (body.episodeId) whereClause.episode_id = body.episodeId;

      const { count } = await prisma.progress_items.deleteMany({
        where: whereClause,
      });

      return {
        count,
        tmdbId,
        episodeId: body.episodeId,
        seasonId: body.seasonId,
      };
    }
  }

  throw createError({
    statusCode: 405,
    message: 'Method not allowed',
  });
});
