import { respondWithJSON } from "./json";
import path from "path";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";

import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { generatePresignedURL, uploadVideoToS3 } from "../s3";
import { rm } from "fs/promises";
import { type Video } from "../db/videos";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

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
  if (videoMetaData?.userID != userID) {
    throw new UserForbiddenError("User is not authenticated to perform this action");
  }

  const formData = await req.formData();
  const videoData = formData.get("video");

  if (!(videoData instanceof File)) {
    throw new BadRequestError("Invalid video ID");
  }

  if (videoData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video too large. Maximum allowed is 1GB.");
  }

  const mediaType = videoData.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("File is in the wrong format. It must be mp4.")
  }

  const arrayBuffer = await videoData.arrayBuffer();
  if (!arrayBuffer) {
    throw new Error("Error reading file data");
  }

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, videoData);

  const processedVideoPath = await processVideoForFastStart(tempFilePath)

  const aspectRatio = await getVideoAspectRatio(tempFilePath);

  let key = `${aspectRatio}/${videoId}.mp4`;
  
  await uploadVideoToS3(cfg, key, processedVideoPath, "video/mp4");

  const videoUrl = `${key}`;
  videoMetaData.videoURL = videoUrl;
  updateVideo(cfg.db, videoMetaData);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(processedVideoPath, { force: true }),
  ]); 

  const signedVideo = await dbVideoToSignedVideo(cfg, videoMetaData);

  return respondWithJSON(200, signedVideo);
}

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["/usr/bin/ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath],
    stdout: "pipe",
    stderr: "pipe",
  }
  );

  const output = await new Response(proc.stdout).text();
  const errors = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error("Something went wrong getting the aspect ratio");
  }

  type streams = {
    programs: [],
    streams: [
      {
        width: number,
        height: number,
      }
    ]
    
  }

  const jsonObj: streams = JSON.parse(output);
  const height = jsonObj.streams[0].height;
  const width = jsonObj.streams[0].width;
  const ratio = width / height;

  if (Math.abs(ratio - 1.77) < 0.1) {
    return "landscape";
  }
  if (Math.abs(ratio - 0.5625) < 0.1) {
    return "portrait";
  }
  return "other";

}

export async function processVideoForFastStart(inputFilePath: string): Promise<string> {

  const outputFilePath = inputFilePath + ".processed";

  const proc = Bun.spawn({
    cmd: ["ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec", 
      "copy", 
      "-f", 
      "mp4",
      outputFilePath,
    ],
    stdout: "pipe",
    stderr: "pipe",})

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error("Something went wrong");
  }

  return outputFilePath;


}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) {
    return video;
  }

  video.videoURL = await generatePresignedURL(cfg, video.videoURL, 5 * 60);

  return video;
}







