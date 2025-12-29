// lib/cloudinary.ts
import { v2 as cloudinary } from "cloudinary";

if (process.env.CLOUDINARY_URL) {
  cloudinary.config(process.env.CLOUDINARY_URL);
} else {
  // Optional: log a warning so you notice in dev
  console.warn(
    "CLOUDINARY_URL is not set. Avatar uploads will fail until it's configured."
  );
}

export { cloudinary };
