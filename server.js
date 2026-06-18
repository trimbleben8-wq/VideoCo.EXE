const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
const jobs = new Map();

app.use(express.static("public"));
const upload = multer({ dest: "uploads/" });

app.post("/convert", upload.single("video"), (req, res) => {
    if (!req.file) return res.status(400).send("No file");
    
    const jobId = Date.now().toString();
    const input = path.resolve(req.file.path);
    const output = path.resolve(`outputs/${jobId}.mp4`);
    const preset = req.body.preset || 'lostepisode';
    
    let selectedSound = null;
    if (preset === 'lostepisode') {
        selectedSound = path.resolve(["Sound1.mp3", "Sound2.mp3", "Sound3.mp3"][Math.floor(Math.random() * 3)]);
    }
    
    const filterMap = {
        yt2006: "[0:v]scale=640:360,noise=alls=10:allf=t[v];[0:a]lowpass=f=1500,highpass=f=200[a]",
        creepypasta: "[0:v]scale=1280:720:flags=neighbor,fps=4,eq=contrast=4.5:brightness=-1.2,colorchannelmixer=rr=1.6[v];[0:a]asetrate=44100*0.4,atempo=2.5,lowpass=f=3000,highpass=f=200[a]",
        lostepisode: "[0:v]scale=640:360,fps=1,eq=contrast=1.5:brightness=0.2:saturation=0.0,noise=alls=25:allf=t[v];[1:a]aloop=loop=-1:size=2e9[a]"
    };

    jobs.set(jobId, { status: "processing", progress: 0 });
    res.json({ jobId });

    const ffprobe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input]);
    let duration = 0;
    ffprobe.stdout.on("data", (d) => duration = parseFloat(d.toString()));

    ffprobe.on("close", () => {
        const durationArg = (duration > 0) ? duration.toString() : "30"; 
        
        const args = selectedSound 
            ? ["-i", input, "-stream_loop", "-1", "-i", selectedSound, "-filter_complex", filterMap[preset], "-map", "[v]", "-map", "[a]"]
            : ["-i", input, "-filter_complex", filterMap[preset], "-map", "[v]", "-map", "[a]"];

        args.push("-c:v", "libx264", "-crf", "35", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", durationArg, "-y", output);

        const ffmpeg = spawn("ffmpeg", args);

        // Progress Tracking
        ffmpeg.stderr.on("data", (data) => {
            const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
            if (timeMatch) {
                const currentSec = parseInt(timeMatch[1])*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]);
                const progress = Math.min(95, Math.round((currentSec / parseFloat(durationArg)) * 100));
                jobs.set(jobId, { status: "processing", progress });
            }
        });

        // Completion Handling
        ffmpeg.on("close", (code) => {
            jobs.set(jobId, { status: code === 0 ? "done" : "error", progress: 100 });
            if (fs.existsSync(input)) fs.unlinkSync(input);
        });
    });
});

app.get("/status/:jobId", (req, res) => res.json(jobs.get(req.params.jobId) || { status: "not_found" }));
app.get("/download/:jobId", (req, res) => {
    const file = path.resolve(`outputs/${req.params.jobId}.mp4`);
    res.download(file, "converted.mp4", () => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        jobs.delete(req.params.jobId);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));