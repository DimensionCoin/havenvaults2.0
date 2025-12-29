// app/api/user/avatar/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";
import { cloudinary } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
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
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    );
  }
}
