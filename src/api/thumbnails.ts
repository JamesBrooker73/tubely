import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getAssetDiskPath, getAssetPath, getAssetURL, mediaTypeToExt } from "./assets";
import { randomBytes } from "crypto";


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const thumbnailMetaData = getVideo(cfg.db, videoId);
  if (!thumbnailMetaData) {
    throw new NotFoundError("Coulnd't find video");
  }
  if (thumbnailMetaData?.userID != userID) {
    throw new UserForbiddenError("User is not authenticated to perform this action");
  }

  const formData = await req.formData();
  const imageData = formData.get("thumbnail");
  if (!(imageData instanceof File)) {
    throw new BadRequestError("Invalid video ID");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (imageData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Image too large. Maximum allowed is 10MB");
  }

  const mediaType = imageData.type;
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("File is the wrong format. It must be a png or jpeg.");
  }

  const arrayBuffer = await imageData.arrayBuffer();
  if (!arrayBuffer) {
      throw new Error("Error reading file data");
  }

  const assetPath = getAssetPath(mediaType);

  const assetDiskPath = getAssetDiskPath(cfg, assetPath);
  await Bun.write(assetDiskPath, imageData);

  const urlPath = getAssetURL(cfg, assetPath);
  thumbnailMetaData.thumbnailURL = urlPath;
  
  updateVideo(cfg.db, thumbnailMetaData);

  return respondWithJSON(200, thumbnailMetaData);
}
