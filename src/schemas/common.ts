import { z } from "zod";

export const idParamsSchema = z.object({ id: z.uuid() });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Booleen transmis en query string : uniquement "true" ou "false". */
export const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Date ISO 8601 avec fuseau (ex. 2026-11-24T00:00:00Z), convertie en Date. */
export const isoDateQuerySchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const isoDateTimeSchema = z.iso.datetime();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: z.object({
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int(),
    }),
  });
}

export function toSkipTake({ page, pageSize }: PaginationQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginationMeta({ page, pageSize }: PaginationQuery, total: number) {
  return { page, pageSize, total };
}
