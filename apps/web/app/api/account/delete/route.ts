import { documents, getDb, sql } from "@redflag/db";
import { logger } from "@redflag/shared";
import { decrypt, deriveKey, getMasterKey } from "@redflag/shared/crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

export async function DELETE() {
  try {
    // Authenticate the user
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {}, // No-op for read-only context
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();
    const serviceClient = getServiceClient();
    const masterKey = getMasterKey();

    // Find all documents belonging to this user
    const userDocs = await db
      .select({ id: documents.id, storagePath: documents.storagePath })
      .from(documents)
      .where(sql`${documents.userId} = ${user.id}`);

    // Delete files from Supabase Storage
    let storageDeleted = 0;
    for (const doc of userDocs) {
      try {
        const docKey = await deriveKey(masterKey, doc.id, "document");
        const decryptedPath = decrypt(doc.storagePath, docKey);
        const { error } = await serviceClient.storage.from("contracts").remove([decryptedPath]);
        if (!error) storageDeleted++;
      } catch {
        // Pre-encryption data or decryption failure — skip
      }
    }

    // Delete document rows (CASCADE handles analyses + clauses)
    if (userDocs.length > 0) {
      await db.delete(documents).where(sql`${documents.userId} = ${user.id}`);
    }

    // Delete the auth user via admin API
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      logger.error("Failed to delete auth user", { userId: user.id, error: deleteError.message });
      return Response.json({ error: "Failed to delete account" }, { status: 500 });
    }

    logger.info("Account deleted", {
      userId: user.id,
      docsDeleted: userDocs.length,
      storageDeleted,
    });

    return Response.json({
      ok: true,
      docsDeleted: userDocs.length,
      storageDeleted,
    });
  } catch (error) {
    logger.error("Account deletion failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Account deletion failed" }, { status: 500 });
  }
}
