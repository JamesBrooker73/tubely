import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo } from "../db/videos";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const UPLOAD_LIMIT = 1 << 30;
  const { videoId } = req.params as { videoId?: string }; 
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMetaData = getVideo(cfg.db, videoId);
  if (!videoMetaData) {
    throw new NotFoundError("Coulnd't find video");
  }
  if (videoMetaData?.userID != userID){
    throw new UserForbiddenError("User is not authenticated to perform this action");
  }

  const formData = await req.formData();
  const videoData = formData.get("video");

  if (!(videoData instanceof File)) {
    throw new BadRequestError("Invalid video ID");
  }

  if (videoData.size)


  return respondWithJSON(200, null);
}







