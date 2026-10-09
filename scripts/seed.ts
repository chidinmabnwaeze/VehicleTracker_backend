// Fills the database with demo data:  npm run seed
// Replace existing demo data:          npm run seed -- --reset
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { env } from "../src/config/env";
import {
  SEED_DRIVER_EMAILS,
  SEED_MANAGER,
  SEED_PASSWORD,
  seedDatabase,
} from "../src/seed/seed";

async function main(): Promise<void> {
  if (!env.mongoUri) {
    throw new Error(
      "MONGO_URI is not set. Without it the server uses a throwaway in-memory database, so seeded data would be lost. Set MONGO_URI in .env first.",
    );
  }
  await connectDatabase();
  const result = await seedDatabase({ reset: process.argv.includes("--reset") });
  await disconnectDatabase();

  if (!result.created) {
    console.log("Demo data is already there. Run `npm run seed -- --reset` to replace it.");
  } else {
    console.log(
      `Seeded 1 manager, ${result.drivers} drivers, ${result.vehicles} vehicles and ${result.trips} trips.`,
    );
  }
  console.log(`\nPassword for every account: ${SEED_PASSWORD}`);
  console.log(`Manager: ${SEED_MANAGER.email}`);
  console.log(`Drivers: ${SEED_DRIVER_EMAILS.join(", ")}`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
