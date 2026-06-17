const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

// Ensure directories exist
if (!fs.existsSync("outputs")) fs.mkdirSync("outputs");
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

app.use(express.static("public"));
const upload = multer({ dest: "uploads/" });

const presets = {
    yt2006: '-vf "scale=426:240,gblur=sigma=0.7,noise=alls=12:allf=t" -r 15 -c:v libx264 -crf 35 -pix_fmt yuv420p -af "aresample=11025,acrusher=bits=6:mode=log,highpass=f=200,lowpass=f=5000" -ar 11025 -ac 1 -b:a 16k',
    creepypasta: '-vf "scale=320:180,scale=1280:720,eq=contrast=2.5:brightness=-0.25:saturation=0.15,colorchannelmixer=rr=1.6:gg=0.1:bb=0.1,unsharp=7:7:2.5,noise=alls=25:allf=t" -r 12 -c:v libx264 -crf 42 -pix_fmt yuv420p -af "rubberband=pitch=0.8:tempo=1,apulsator=hz=0.5,aecho=0.8:0.9:500:0.3" -ar 8000 -ac 1 -b:a 8k',
    lostepisode: '-vf "scale=240:135,scale=1280:720,eq=contrast=2.0:brightness=-0.2:saturation=0.3,gblur=sigma=1.0,noise=alls=25:allf=t,loop=loop=6:size=1:start=50,unsharp=5:5:1.0" -r 1 -c:v libx264 -crf 42 -pix_fmt yuv420p'
};

app.post("/convert", upload.single("video"), (req, res) => {
    console.log("--- Request Received ---");
    if (!req.file) {
        console.log("Error: No file uploaded");
        return res.status(400).send("No file uploaded");
    }

    const input = path.resolve(req.file.path);
    const output = path.resolve(`outputs/${Date.now()}.mp4`);
    const presetName = req.body.preset || "yt2006";
    const videoSettings = presets[presetName];

    let cmd;
    if (presetName === "lostepisode") {
        // Ensure these files are in the root directory
        const sounds = ["Sound1.mp3", "Sound2.mp3", "Sound3.mp3"];
        const selectedSound = sounds[Math.floor(Math.random() * sounds.length)];
        cmd = `ffmpeg -i "${input}" -stream_loop -1 -i "${selectedSound}" -filter_complex "[1:a]aloop=loop=-1:size=2e9,aresample=44100[a_loop]" -map 0:v -map "[a_loop]" ${videoSettings} -shortest -y "${output}"`;
    } else {
        cmd = `ffmpeg -i "${input}" ${videoSettings} "${output}" -y`;
    }

    console.log("Executing Command:", cmd);

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error("FFmpeg Execution Error:", error.message);
            console.error("FFmpeg Stderr Output:", stderr);
            return res.status(500).send("Conversion failed: " + stderr);
        }
        
        console.log("Conversion successful, sending file...");
        res.download(output, (err) => {
            if (err) console.error("Download error:", err);
            // Cleanup
            if (fs.existsSync(input)) fs.unlinkSync(input);
            if (fs.existsSync(output)) fs.unlinkSync(output);
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));