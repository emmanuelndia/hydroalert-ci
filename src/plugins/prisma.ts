import { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

type PrismaPluginOptions = {
  databaseCheck?: () => Promise<void>;
};

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    databaseCheck: () => Promise<void>;
  }
}

const prismaPluginImplementation: FastifyPluginAsync<PrismaPluginOptions> = async (
  app,
  options,
) => {
  const prisma = new PrismaClient();

  app.decorate("prisma", prisma);
  app.decorate(
    "databaseCheck",
    options.databaseCheck ??
      (async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
  );
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
};

export const prismaPlugin = fp(prismaPluginImplementation, {
  name: "prisma",
});
