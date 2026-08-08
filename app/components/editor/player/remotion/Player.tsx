import { Player, PlayerRef } from "@remotion/player";
import {ProjectComposition} from "@/remotion/ProjectComposition";
import { useAppSelector } from "@/app/store";
import { useRef, useEffect } from "react";
import { setIsPlaying } from "@/app/store/slices/projectSlice";
import { useDispatch } from "react-redux";

export const PreviewPlayer = () => {
    const projectState = useAppSelector((state) => state.projectState);
    const { duration, currentTime, isPlaying, isMuted } = projectState;
    const fps = Number.isFinite(projectState.fps) && projectState.fps > 0 ? projectState.fps : 30;
    const width = Number.isFinite(projectState.resolution?.width) && projectState.resolution.width > 0 ? projectState.resolution.width : 1920;
    const height = Number.isFinite(projectState.resolution?.height) && projectState.resolution.height > 0 ? projectState.resolution.height : 1080;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1 / fps;
    const playerRef = useRef<PlayerRef>(null);
    const dispatch = useDispatch();

    // update frame when current time with marker
    useEffect(() => {
        const frame = Math.round(currentTime * fps);
        if (playerRef.current && !isPlaying) {
            playerRef.current.pause();
            playerRef.current.seekTo(frame);
        }
    }, [currentTime, fps, isPlaying]);

    useEffect(() => {
        const player = playerRef.current;
        if (!player) return;
        const onPlay = () => dispatch(setIsPlaying(true));
        const onPause = () => dispatch(setIsPlaying(false));
        player.addEventListener("play", onPlay);
        player.addEventListener("pause", onPause);
        return () => {
            player.removeEventListener("play", onPlay);
            player.removeEventListener("pause", onPause);
        };
    }, [dispatch]);

    // to control with keyboard
    useEffect(() => {
        if (!playerRef.current) return;
        if (isPlaying) {
            playerRef.current.play();
        } else {
            playerRef.current.pause();
        }
    }, [isPlaying]);

    useEffect(() => {
        if (!playerRef.current) return;
        if (isMuted) {
            playerRef.current.mute();
        } else {
            playerRef.current.unmute();
        }
    }, [isMuted]);

    return (
        <Player
            ref={playerRef}
            component={ProjectComposition}
            inputProps={{project: projectState}}
            durationInFrames={Math.max(2, Math.ceil(safeDuration * fps))}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            style={{ width: "100%", height: "100%" }}
            controls
            clickToPlay={false}
            acknowledgeRemotionLicense
        />
    )
};