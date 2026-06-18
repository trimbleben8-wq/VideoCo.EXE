const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

// Ensure directories exist on startup
const UPLOADS_DIR = path.join(__dirname, "uploads");
const OUTPUTS_DIR = path.join(__dirname, "outputs");
[UPLOADS_DIR, OUTPUTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const jobs = new Map();
app.use(express.static("public"));
const upload = multer({ dest: "uploads/" });

app.post("/convert", upload.single("video"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");
    
    const jobId = Date.now().toString();
    const input = path.resolve(req.file.path);
    const output = path.resolve(OUTPUTS_DIR, `${jobId}.mp4`);
    const preset = req.body.preset || 'lostepisode';
    
    let selectedSound = null;
    if (preset === 'lostepisode') {
        // Ensure your sound files are in the root directory
        const sounds = ["Sound1.mp3", "Sound2.mp3", "Sound3.mp3"];
        selectedSound = path.resolve(sounds[Math.floor(Math.random() * sounds.length)]);
    }
    
    const filterMap = {
        yt2006: "[0:v]scale=640:360,noise=alls=10:allf=t[v];[0:a]lowpass=f=1500,highpass=f=200[a]",
        creepypasta: "[0:v]scale=1280:720:flags=neighbor,fps=4,eq=contrast=4.5:brightness=-1.2,colorchannelmixer=rr=1.6[v];[0:a]asetrate=44100*0.4,atempo=2.5,lowpass=f=3000,highpass=f=200[a]",
        lostepisode: "[0:v]scale=640:360,fps=1,eq=contrast=1.5:brightness=0.2:saturation=0.0,noise=alls=25:allf=t[v];[1:a]aloop=loop=-1:size=2e9[a]"
    };

    jobs.set(jobId, { status: "processing", progress: 0 });
    res.json({ jobId });

    // Use ffprobe to get duration
    const ffprobe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input]);
    let duration = 0;
    ffprobe.stdout.on("data", (d) => duration = parseFloat(d.toString()));

    ffprobe.on("close", () => {
        const durationArg = (duration > 0 && !isNaN(duration)) ? duration.toString() : "30";
        
        const args = selectedSound 
            ? ["-i", input, "-stream_loop", "-1", "-i", selectedSound, "-filter_complex", filterMap[preset], "-map", "[v]", "-map", "[a]"]
            : ["-i", input, "-filter_complex", filterMap[preset], "-map", "[v]", "-map", "[a]"];

        args.push("-c:v", "libx264", "-crf", "35", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", durationArg, "-y", output);

        const ffmpeg = spawn("ffmpeg", args);

        // LOGGING: This will show in Render's "Logs" tab
        ffmpeg.stderr.on("data", (data) => {
            console.log(`FFMPEG: ${data.toString()}`);
            const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
            if (timeMatch) {
                const currentSec = parseInt(timeMatch[1])*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]);
                const progress = Math.min(95, Math.round((currentSec / parseFloat(durationArg)) * 100));
                jobs.set(jobId, { status: "processing", progress });
            }
        });

        ffmpeg.on("error", (err) => {
            console.error("FFmpeg spawn error:", err);
            jobs.set(jobId, { status: "error" });
        });

        ffmpeg.on("close", (code) => {
            if (code === 0) {
                jobs.set(jobId, { status: "done", progress: 100 });
            } else {
                console.error(`FFmpeg exited with code ${code}`);
                jobs.set(jobId, { status: "error" });
            }
            if (fs.existsSync(input)) fs.unlink(input, () => {});
        });
    });
});

app.get("/status/:jobId", (req, res) => res.json(jobs.get(req.params.jobId) || { status: "not_found" }));
app.get("/download/:jobId", (req, res) => {
    const file = path.resolve(OUTPUTS_DIR, `${req.params.jobId}.mp4`);
    if (!fs.existsSync(file)) return res.status(404).send("File not found");
    res.download(file, "converted.mp4", () => {
        if (fs.existsSync(file)) fs.unlink(file, () => {});
        jobs.delete(req.params.jobId);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
