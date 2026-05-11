const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const API_BASE_URL = process.env.AQAR_API_BASE_URL || "http://localhost:8080";
const AQAR_ROOT = process.env.AQAR_AI_ROOT || "/home/eiad/Projects/Aqar-AI";
const DATA_DIR = path.join(AQAR_ROOT, "Data");
const SOURCE_JSON = process.env.AQAR_SEED_JSON || path.join(DATA_DIR, "preprocessed_properties.json");
const DEFAULT_EMAIL = process.env.AQAR_SEED_EMAIL || "default@example.com";
const DEFAULT_PASSWORD = process.env.AQAR_SEED_PASSWORD || "Password$123";

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) {
    throw new Error(`Login failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.token;
}

async function createTokenFromDefaultUser() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "RealEstateDB",
  });

  const [users] = await connection.execute(
    "SELECT user_id, email, is_verified FROM Users WHERE email = ? LIMIT 1",
    [DEFAULT_EMAIL],
  );
  await connection.end();

  if (users.length === 0) {
    throw new Error(`Default user was not found: ${DEFAULT_EMAIL}`);
  }

  return jwt.sign(
    {
      userId: users[0].user_id,
      email: users[0].email,
      is_verified: users[0].is_verified,
    },
    process.env.JWT_SECRET_KEY,
    { expiresIn: "3h" },
  );
}

async function appendImage(form, fieldName, imagePath) {
  const blob = await fs.openAsBlob(imagePath, { type: "image/jpeg" });
  form.append(fieldName, blob, path.basename(imagePath));
}

async function postProperty(token, record) {
  const form = new FormData();

  form.append("propertyName", record.property_name);
  form.append("propertyDesc", record.property_desc);
  form.append("location", record.location);
  form.append("pricingUnit", record.pricing_unit || "DAY");
  form.append("priceValue", String(record.price_value));
  form.append("size", String(record.size));
  form.append("bedroomsNumber", String(record.bedrooms_no));
  form.append("bedsNumber", String(record.beds_no));
  form.append("bathroomsNumber", String(record.bathrooms_no));
  form.append("property_type", record.property_type || "for_sale");
  form.append("latitude", String(record.latitude));
  form.append("longitude", String(record.longitude));
  form.append("sellingPlan", "1");

  if (record.is_furnished) {
    form.append("is_furnished", "true");
  }

  const sourceImages = [];
  for (const relativeImage of record.source_images || []) {
    const sourcePath = path.join(DATA_DIR, relativeImage);
    if (await pathExists(sourcePath)) sourceImages.push(sourcePath);
  }

  if (sourceImages.length === 0) {
    throw new Error(`Record ${record.source_index} has no source images`);
  }

  for (const imagePath of sourceImages.slice(0, 10)) {
    await appendImage(form, "images", imagePath);
  }
  await appendImage(form, "ownershipProof", sourceImages[0]);

  const response = await fetch(`${API_BASE_URL}/property`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `POST /property failed for #${record.source_index} (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function resetPreviousDirectImport(records) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "RealEstateDB",
  });

  const names = records.map((record) => record.property_name);
  let deleted = 0;
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    const [result] = await connection.execute(
      `
        DELETE FROM Property
        WHERE property_name IN (${placeholders})
          AND (
            images LIKE '%aqar_seed_%'
            OR ownership_proofs = '[]'
          )
      `,
      chunk,
    );
    deleted += result.affectedRows;
  }

  await connection.end();

  const uploadsDir = path.resolve(__dirname, "..", "uploads", "property");
  const files = (await pathExists(uploadsDir)) ? await fsp.readdir(uploadsDir) : [];
  let removedFiles = 0;
  for (const file of files) {
    if (!file.startsWith("aqar_seed_")) continue;
    await fsp.rm(path.join(uploadsDir, file), { force: true });
    removedFiles += 1;
  }

  console.log(`Deleted previous direct-import properties: ${deleted}`);
  console.log(`Removed previous direct-import image files: ${removedFiles}`);
}

async function main() {
  const shouldReset = process.argv.includes("--reset-direct-import");
  const records = await readJson(SOURCE_JSON);

  if (shouldReset) {
    await resetPreviousDirectImport(records);
  }

  let token;
  try {
    token = await login();
  } catch (error) {
    console.warn(`${error.message}. Falling back to a locally signed seed token.`);
    token = await createTokenFromDefaultUser();
  }
  let created = 0;

  for (const record of records) {
    const result = await postProperty(token, record);
    created += 1;
    console.log(
      `${created}/${records.length} created source #${record.source_index}: propertyId=${result.propertyId}`,
    );
  }

  console.log(`Created properties through POST /property: ${created}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
