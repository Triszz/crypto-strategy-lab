import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanNewsAndSentiments() {
  console.log("🧹 Cleaning news, news_coins, and sentiments tables...");

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "sentiments", "news_coins", "news" CASCADE;`);
    console.log("✅ Successfully cleaned news, news_coins, and sentiments tables!");
  } catch (err) {
    console.error("❌ Failed to truncate tables via SQL, running fallback deleteMany...", err);
    await prisma.sentiment.deleteMany();
    await prisma.newsCoin.deleteMany();
    await prisma.news.deleteMany();
    console.log("✅ Fallback deleteMany completed!");
  } finally {
    await prisma.$disconnect();
  }
}

cleanNewsAndSentiments();
