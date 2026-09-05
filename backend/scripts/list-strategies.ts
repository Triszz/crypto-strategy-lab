import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const rows = await p.strategyVersion.findMany({
    where: { isActive: true },
    take: 10,
    include: { definition: true },
  });
  console.log(JSON.stringify(rows, null, 2));
}
main().finally(() => p.$disconnect());
