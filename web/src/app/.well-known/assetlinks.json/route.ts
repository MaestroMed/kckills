/**
 * /.well-known/assetlinks.json — V45 (Wave 26.3).
 *
 * Served at https://kckills.com/.well-known/assetlinks.json so
 * Android trusts the TWA-wrapped web app and skips the address-bar
 * "verifying" warning.
 *
 * The fingerprint is the SHA-256 of the signing keystore ; we'll
 * generate it during Bubblewrap setup and replace the placeholder
 * before the first Play Store upload.
 *
 * Why a route instead of a static JSON in /public : Next.js's
 * `/public` doesn't allow dot-prefixed paths reliably across
 * deploy targets. Routing it as an API route + `Cache-Control:
 * public, max-age=86400` keeps it served correctly from Vercel
 * edge.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Long cache : the asset-links list rarely changes ; daily refresh
// is enough for any future signing-key rotation.
export const revalidate = 86400;

const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.kckills.app",
      // PLACEHOLDER — replace with the actual SHA-256 fingerprint
      // of the upload signing key after `bubblewrap build`. Find
      // it via `keytool -list -v -keystore <name>.keystore`.
      sha256_cert_fingerprints: [
        "REPLACE:WITH:ACTUAL:SHA256:FINGERPRINT:FROM:UPLOAD:KEYSTORE",
      ],
    },
  },
];

export async function GET() {
  return NextResponse.json(ASSET_LINKS, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Content-Type": "application/json",
    },
  });
}
