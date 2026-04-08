import type { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = Prisma.TransactionClient;
export type RootDbClient = PrismaClient;
