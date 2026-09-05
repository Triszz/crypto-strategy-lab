import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const allBR = await prisma.backtestResult.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
    include: { experiment: true }
  });
  console.log('Total:', allBR.length);
  for (const br of allBR) {
    console.log({id: br.id, experimentId: br.experimentId, hasExp: !!br.experiment, expCandidate: br.experiment?.candidateId});
  }
  const orphans = await prisma.backtestResult.findMany({
    where: { experiment: null },
    take: 10,
  });
  console.log('Orphan BR count:', orphans.length);
}
main().finally(() => prisma.$disconnect());
