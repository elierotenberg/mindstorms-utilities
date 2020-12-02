const path = require("path");
const { safeLoad, safeDump } = require("js-yaml");
const { promises } = require("fs");
const { ok } = require("assert");
const readline = require("readline");
const { v4: uuid } = require("uuid");
const { join } = require("path");
const crypto = require("crypto");

const prompt = (rl, question) =>
  new Promise((resolve) => rl.question(question, resolve));

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

const POLL_SOURCE_INTERVAL = 1000;
const POLL_DESTINATION_INTERVAL = 1000;

const padLeft = (length, fill, str) => {
  let out = `${str}`;
  while (out.length < length) {
    out = `${fill}${out}`;
  }
  return out;
};

const getTimeOfDay = () => {
  const d = new Date();
  return `${padLeft(2, "0", d.getHours())}:${padLeft(
    2,
    "0",
    d.getMinutes()
  )}:${padLeft(2, "0", d.getSeconds())}.${padLeft(
    3,
    "0",
    d.getMilliseconds()
  )}`;
};

const print = (firstArg, ...args) =>
  console.log(`[${getTimeOfDay()}]: ${firstArg}`, ...args);

const pollReadSourceFiles = async (path) => {
  let count = 0;
  while (true) {
    print(`Poll read ${path} (${++count})`);
    try {
      return await promises.readdir(path);
    } catch (error) {}
    await sleep(POLL_SOURCE_INTERVAL);
  }
};

const pollWriteDestinationFile = async (path, buffer) => {
  let count = 0;
  while (true) {
    print(`Poll write ${path} (${++count})`);
    try {
      return await promises.writeFile(path, buffer);
    } catch (error) {
      console.error(error);
      await sleep(POLL_DESTINATION_INTERVAL);
    }
  }
};

const checkDeviceConfig = (deviceConfig) => {
  ok(typeof deviceConfig === "object" && deviceConfig !== null);
  ok(typeof deviceConfig.deviceId === "string");
  ok(typeof deviceConfig.log == "object" && deviceConfig.log !== null);
  ok(Array.isArray(deviceConfig.log));
  for (const item of deviceConfig.log) {
    ok(typeof item === "object" && item !== null);
    ok(item.date instanceof Date);
    ok(typeof item.path == "string");
    ok(typeof item.hash === "string");
  }
};

const readDeviceConfig = async (path) => {
  try {
    return await promises
      .readFile(path, { encoding: "utf-8" })
      .then(safeLoad)
      .then((deviceConfig) => {
        checkDeviceConfig(deviceConfig);
        return deviceConfig;
      });
  } catch (error) {
    const deviceConfig = {
      deviceId: uuid(),
      log: [],
    };
    await writeDeviceConfig(path, deviceConfig);
    return deviceConfig;
  }
};

const writeDeviceConfig = async (path, deviceConfig) => {
  await promises.writeFile(path, safeDump(deviceConfig), { encoding: "utf-8" });
};

const main = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sourceRoot = path.resolve(
    process.cwd(),
    await prompt(rl, `Enter source folder (e.g. D:\\): `)
  );

  const destinationRoot = path.resolve(
    process.cwd(),
    await prompt(rl, `Enter destination folder (e.g. U:\\): `)
  );

  rl.close();
  while (true) {
    const sourceFiles = await pollReadSourceFiles(sourceRoot);
    const deviceConfigFile = join(
      sourceRoot,
      ".mindstorms-utilities.device.yml"
    );
    const deviceConfig = await readDeviceConfig(deviceConfigFile);
    for (const sourceFile of sourceFiles) {
      if (!sourceFile.endsWith(".uf2")) {
        continue;
      }
      const sourceFileContents = await promises.readFile(
        join(sourceRoot, sourceFile)
      );
      const hash = crypto
        .createHash("sha512")
        .update(sourceFileContents)
        .digest("hex");
      const prevItem = deviceConfig.log.find((item) => item.hash === hash);
      if (prevItem) {
        print(`${sourceFile} already copied (${prevItem.date.toString()})`);
      } else {
        await pollWriteDestinationFile(
          join(destinationRoot, sourceFile),
          sourceFileContents
        );
        deviceConfig.log.push({
          date: new Date(),
          path: sourceFile,
          hash,
        });
        await writeDeviceConfig(deviceConfigFile, deviceConfig);
      }
    }
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
