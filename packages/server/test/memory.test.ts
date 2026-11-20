import { MemoryDatabase, MemoryStorage } from "../src/adapters/memory";
import { runDatabaseAdapterConformance, runStorageAdapterConformance } from "../src/testing";

runDatabaseAdapterConformance("MemoryDatabase", () => new MemoryDatabase());
runStorageAdapterConformance("MemoryStorage", () => new MemoryStorage());
