// app/api/user/avatar/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";
import { cloudinary } from "@/lib/cloudinary";
import { validateCsrf } from "@/lib/csrf";
import { withApiLogging } from "@/lib/withApiLogging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

function getFileMeta(file: Blob) {
  const f = file as { size?: unknown; type?: unknown; name?: unknown };
  const size = typeof f.size === "number" ? f.size : undefined;
  const type = typeof f.type === "string" ? f.type : "";
  const name = typeof f.name === "string" ? f.name : "";
  return { size, type, name };
}

function normalizeUploadError(err: unknown): { message?: string; status?: number } {
  if (!err || typeof err !== "object") return {};
  const rec = err as Record<string, unknown>;
  const message = typeof rec.message === "string" ? rec.message : undefined;
  const httpCode = typeof rec.http_code === "number" ? rec.http_code : undefined;
  const status =
    typeof httpCode === "number" && httpCode >= 400 && httpCode <= 599
      ? httpCode
      : undefined;
  return { message, status };
}

async function POSTHandler(req: NextRequest) {
  try {
    const csrfError = validateCsrf(req);
    if (csrfError) return csrfError;

    await connect();

    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;

    const user = await User.findOne({ privyId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!process.env.CLOUDINARY_URL) {
      return NextResponse.json(
        { error: "Cloudinary not configured on server" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing or invalid file upload" },
        { status: 400 }
      );
    }

    const { size, type } = getFileMeta(file);
    if (typeof size === "number" && size <= 0) {
      return NextResponse.json({ error: "Empty file upload" }, { status: 400 });
    }
    if (typeof size === "number" && size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: "Image is too large. Max size is 5MB." },
        { status: 413 }
      );
    }
    if (!type) {
      return NextResponse.json(
        { error: "Missing Content-Type. Please provide an image MIME type." },
        { status: 400 }
      );
    }
    if (!type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload an image." },
        { status: 400 }
      );
    }
    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      return NextResponse.json(
        { error: "Unsupported image format. Use JPG, PNG, WebP, GIF, or HEIC." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadResult = await new Promise<{ secure_url?: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "haven/avatars",
            public_id: user._id.toString(),
            overwrite: true,
            resource_type: "image",
            transformation: [
              { width: 256, height: 256, crop: "fill", gravity: "face" },
              { quality: "auto", fetch_format: "auto" },
            ],
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result ?? {});
          }
        );

        stream.end(buffer);
      }
    );

    const secureUrl = uploadResult.secure_url as string | undefined;

    if (!secureUrl) {
      return NextResponse.json(
        { error: "Failed to get Cloudinary URL" },
        { status: 500 }
      );
    }

    user.profileImageUrl = secureUrl;
    await user.save();

    return NextResponse.json(
      {
        ok: true,
        url: secureUrl,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in POST /api/user/avatar:", err);
    const normalized = normalizeUploadError(err);
    return NextResponse.json(
      {
        error:
          normalized.message && normalized.message.length <= 200
            ? normalized.message
            : "Failed to upload avatar",
      },
      { status: normalized.status ?? 500 }
    );
  }
}

export const POST = withApiLogging("/api/user/avatar", POSTHandler);
