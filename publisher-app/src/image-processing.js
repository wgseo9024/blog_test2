import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const normalizeImageUrl = (value, stripQuery = false) => { const url = new URL(value); url.hash = ""; if (stripQuery) url.search = ""; url.hostname = url.hostname.toLowerCase(); return url.href; };
export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
export const cropPixelsFor = (height) => Number(height) < 500 ? 0 : Math.min(Math.round(Number(height) * 0.15), 180);
export const privateR2Keys = (groupId, imageId, ext) => ({ original: `private/original/${groupId}/${imageId}.${String(ext).replace(/^\./,"").toLowerCase()}`, processed: `private/processed/${groupId}/${imageId}.jpg` });
export const hammingDistance = (a,b) => [...String(a)].reduce((n,c,i)=>n+(c!==String(b)[i]),0);

export async function dHash(buffer, sharpModule) {
  const sharp = sharpModule || (await import("sharp")).default;
  const { data } = await sharp(buffer).rotate().greyscale().resize(9,8,{fit:"fill"}).raw().toBuffer({resolveWithObject:true});
  let bits=""; for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits+=data[y*9+x]>data[y*9+x+1]?"1":"0";
  return BigInt(`0b${bits}`).toString(16).padStart(16,"0");
}

export async function inspectAndProcess(buffer, options = {}) {
  if (!options.approvedForUse) throw new Error("IMAGE_NOT_APPROVED");
  if (!Buffer.isBuffer(buffer) || buffer.length <= 100 * 1024) throw new Error("IMAGE_TOO_SMALL_BYTES");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const sharp = options.sharp || (await import("sharp")).default;
  const source = sharp(buffer, { animated: false }).rotate();
  const metadata = await source.metadata();
  if (!new Set(["jpeg","png","webp"]).has(metadata.format)) throw new Error(metadata.format === "gif" ? "GIF_CROP_FORBIDDEN" : "UNSUPPORTED_IMAGE_TYPE");
  if ((metadata.width || 0) < 400 || (metadata.height || 0) < 300) throw new Error("IMAGE_DIMENSIONS_TOO_SMALL");
  const cropPixels = cropPixelsFor(metadata.height);
  if (!cropPixels) throw new Error("CROP_FORBIDDEN_UNDER_500PX");
  if (metadata.height - cropPixels < 400) throw new Error("CROP_RESULT_TOO_SMALL");
  if (options.sensitiveContentSuspected) throw new Error("REVIEW_REQUIRED_SENSITIVE_CROP");
  const processed = await source.extract({left:0,top:0,width:metadata.width,height:metadata.height-cropPixels}).jpeg({quality:88}).toBuffer();
  return { processed, contentType:"image/jpeg", width:metadata.width, height:metadata.height, cropPixels, cropPercent:cropPixels/metadata.height, sizeBytes:buffer.length, sha256:sha256(buffer), perceptualHash:await dHash(buffer,sharp) };
}

export const extensionFromContentType = (type) => ({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[String(type).toLowerCase()] || path.extname("x.bin").slice(1));
