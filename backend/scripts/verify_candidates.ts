import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const candidateIds = [
    "3f708ec4-02f5-4429-8cec-7b755e71a6ec",
    "e1eb96ff-bc9b-40e9-8aa4-9fadab722fda",
    "c23e7a2f-81a6-42af-b8f4-98b67addda45",
  ];

  const exps = await prisma.experiment.findMany({
    where: { candidateId: { in: candidateIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      candidateId: true,
      name: true,
      timeframe: true,
      status: true,
      createdAt: true,
    },
  });

  console.log("Experiments linked to Search candidates:");
  for (const e of exps) {
    console.log({
      experimentId: e.id,
      candidateId: e.candidateId,
      name: e.name,
      timeframe: e.timeframe,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    });
  }
  console.log(`Total experiments for search candidates: ${exps.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
