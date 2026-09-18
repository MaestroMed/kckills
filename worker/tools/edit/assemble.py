# -*- coding: utf-8 -*-
"""
ASSEMBLE v2 — moteur de montage TikTok (1080x1920, 30 fps, NVENC).

Entrée : un plan de montage JSON
{
  "music": "path.mp3" | null,          # piste principale
  "music_offset": 12.0,                # seconde de la musique où démarre l'edit
  "bpm": 92,                           # grille (les cuts tombent sur les temps)
  "caster_db": -14,                    # voix casters sous la musique (dB), null = muet
  "hook":  {"src": "...", "in": 12.4, "out": 13.7, "punch": 13.0}     # cold open (2 temps), optionnel
  "intro": {"title": "SUMMER 2026", "sub": "KARMINE CORP", "beats": 4},
  "shots": [ {"src": "...v.mp4", "in": 12.4, "out": 15.0, "punch": 13.6,
              "label": "CALISTE", "tag": "QUADRA", "speed": 1.0,
              "ramp": true,            # slow-mo 0.5x jusqu'à l'impact (2 segments), puis temps réel
              "aspect": "16:9",        # source VOD horizontale → centre 9:16
              "crop_top": 0.06, "crop_bottom": 0.24} , ... ],
  "outro": {"title": "KCKILLS.COM", "sub": "...", "beats": 4}
}
Effets : crop HUD, zoom-punch 1.12→1.30 + shake 4 frames + flash blanc sur `punch`,
overlays pop-in (Oswald pseudo / Impact tag or), vignette + contraste, slow-mo
avant impact (ramp), concat, mix musique + casters duckés, loudnorm -14 LUFS.
Usage : python assemble.py plan.json out.mp4
"""
import json, os, subprocess, sys, tempfile, shutil

FONT_OSWALD = "D\\:/kckills_worker/edit_summer/assets/Oswald.ttf"
FONT_IMPACT = "C\\:/Windows/Fonts/impact.ttf"
GOLD = "#C8AA6E"
W, H, FPS = 1080, 1920, 30
RAMP_EPS = 0.15          # s de source à vitesse réelle avant l'impact
SLOW = 0.5               # facteur de la slow-mo
ENC = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(" ".join(cmd[:12]) + "\n" + r.stderr[-1500:])
    return r


def esc(t):
    return str(t).replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def geometry(shot):
    """crop HUD + (centre 9:16 pour une source 16:9) + scale 1080x1920."""
    ct, cb = float(shot.get("crop_top", 0.06)), float(shot.get("crop_bottom", 0.24))
    vf = []
    if shot.get("aspect") == "16:9":
        vf.append("crop=ih*9/16:ih:(iw-ih*9/16)/2:0")
    vf += [f"crop=iw:ih*{1-ct-cb:.3f}:0:ih*{ct:.3f}", "scale=1080:1920:flags=lanczos"]
    return vf


def src_fps(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        n, d = r.stdout.strip().split("/")
        return float(n) / float(d)
    except Exception:
        return 30.0


def overlays(shot, t0=0.05):
    """pseudo (pop-in alpha + glissement) + tag or."""
    vf = []
    if shot.get("label"):
        vf.append(f"drawtext=fontfile='{FONT_OSWALD}':text='{esc(shot['label'])}':fontsize=118:fontcolor=white:borderw=7:bordercolor=black:"
                  f"x=(w-text_w)/2:y='h*0.70+24*(1-min(1,max(0,(t-{t0})/0.12)))':alpha='min(1,max(0,(t-{t0})/0.08))'")
    if shot.get("tag"):
        vf.append(f"drawtext=fontfile='{FONT_IMPACT}':text='{esc(shot['tag'])}':fontsize=84:fontcolor={GOLD}:borderw=5:bordercolor=black:"
                  f"x=(w-text_w)/2:y='h*0.77+24*(1-min(1,max(0,(t-{t0+0.06})/0.12)))':alpha='min(1,max(0,(t-{t0+0.06})/0.08))'")
    return vf


def punch_fx(p_rel):
    """zoom sec + shake 4 frames + flash blanc sur l'impact (p_rel en s dans le segment)."""
    zoom = f"if(between(in_time,{p_rel:.3f},{p_rel+0.35:.3f}),1.30-0.18*((in_time-{p_rel:.3f})/0.35),1.12)"
    vf = [f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}",
          f"crop=w=iw-48:h=ih-48:x='24+if(between(t,{p_rel:.3f},{p_rel+0.13:.3f}),(random(1)-0.5)*44,0)':y='24+if(between(t,{p_rel:.3f},{p_rel+0.13:.3f}),(random(2)-0.5)*44,0)'",
          f"scale={W}:{H}"]
    flash = f"drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=fill:enable='between(t,{p_rel:.3f},{p_rel+0.07:.3f})'"
    return vf, flash


def grade():
    return ["eq=contrast=1.06:saturation=1.12", "vignette=PI/6.5"]


def encode_segment(src, tin, dur, speed, vf, dst, audio_pitch=False):
    """`vf` doit déjà contenir la gestion du temps (fps=... en tête, setpts en queue si slow-mo)."""
    af = "anull"
    if speed != 1.0:
        af = f"asetrate=48000*{speed},aresample=48000" if audio_pitch else f"atempo={speed}"
    # -t en option de SORTIE (durée finale = source / vitesse) : en option d'entrée, l'audio
    # ré-échantillonné (asetrate) sortait 2x trop long.
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{tin:.3f}", "-t", f"{dur + 0.5:.3f}", "-i", src,
           "-filter_complex", f"[0:v]{','.join(vf)}[v];[0:a]{af},aresample=48000[a]",
           "-map", "[v]", "-map", "[a]", "-r", str(FPS), "-t", f"{dur / speed:.3f}"] + ENC + [dst]
    run(cmd)


def render_shot(shot, dst_base, beat):
    """→ liste de segments rendus (2 si slow-mo ramp)."""
    src, tin, tout = shot["src"], float(shot["in"]), float(shot["out"])
    speed = float(shot.get("speed", 1.0))
    punch = shot.get("punch")
    out = []
    if shot.get("ramp") and punch is not None and float(punch) - RAMP_EPS - tin > 0.25:
        # segment A : slow-mo jusqu'à RAMP_EPS avant l'impact (pitch des voix baissé = dramatique)
        a_in, a_dur = tin, (float(punch) - RAMP_EPS) - tin
        pre = ["fps=60"] if src_fps(src) >= 50 else ["fps=30", "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"]
        vf = pre + geometry(shot) + [f"crop=iw/1.12:ih/1.12", f"scale={W}:{H}"] + grade() + overlays(shot) + [f"setpts={1/SLOW:.1f}*PTS"]
        pa = dst_base + "_a.mp4"
        encode_segment(src, a_in, a_dur, SLOW, vf, pa, audio_pitch=True)
        out.append(pa)
        # segment B : temps réel, impact à RAMP_EPS
        b_in, b_dur = float(punch) - RAMP_EPS, tout - (float(punch) - RAMP_EPS)
        pf, flash = punch_fx(RAMP_EPS)
        vf = [f"fps={FPS}"] + geometry(shot) + pf + grade() + overlays(shot, t0=-1.0) + [flash]
        pb = dst_base + "_b.mp4"
        encode_segment(src, b_in, max(0.3, b_dur), 1.0, vf, pb)
        out.append(pb)
        return out
    dur = max(0.4, tout - tin)
    p_rel = None if punch is None else max(0.0, (float(punch) - tin) / speed)
    if p_rel is not None:
        pf, flash = punch_fx(p_rel)
        vf = [f"fps={FPS}"] + geometry(shot) + pf + grade() + overlays(shot) + [flash]
    else:
        vf = [f"fps={FPS}"] + geometry(shot) + [f"crop=iw/1.12:ih/1.12", f"scale={W}:{H}"] + grade() + overlays(shot)
    p = dst_base + ".mp4"
    encode_segment(src, tin, dur, speed, vf, p)
    out.append(p)
    return out


def render_card(title, sub, dur, dst, logo=None):
    inputs = ["-f", "lavfi", "-i", f"color=c=0x010A13:s={W}x{H}:r={FPS}:d={dur:.3f}", "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo:d={dur:.3f}"]
    vf = (f"drawtext=fontfile='{FONT_OSWALD}':text='{esc(title)}':fontsize=170:fontcolor=white:borderw=6:bordercolor=black:x=(w-text_w)/2:y=h*0.46:"
          f"alpha='min(1,max(0,(t-0.05)/0.15))'")
    if sub:
        vf += f",drawtext=fontfile='{FONT_IMPACT}':text='{esc(sub)}':fontsize=80:fontcolor={GOLD}:x=(w-text_w)/2:y=h*0.56:alpha='min(1,max(0,(t-0.2)/0.15))'"
    vf += f",drawbox=x=(iw-520)/2:y=ih*0.535:w=520:h=4:color={GOLD}@0.9:t=fill:enable='gte(t,0.15)'"
    if logo and os.path.exists(logo):
        inputs = ["-i", logo] + inputs
        fc = f"[0:v]scale=420:-1[lg];[1:v][lg]overlay=(W-w)/2:H*0.22[b];[b]{vf},fade=t=in:st=0:d=0.25,fade=t=out:st={max(0, dur-0.3):.2f}:d=0.3[v]"
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + inputs + ["-filter_complex", fc, "-map", "[v]", "-map", "2:a", "-t", f"{dur:.3f}"]
    else:
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + inputs + ["-vf", vf, "-t", f"{dur:.3f}"]
    run(cmd + ENC + [dst])
    return dur


def main(plan_path, out_path):
    plan = json.load(open(plan_path, encoding="utf-8"))
    beat = 60.0 / float(plan.get("bpm", 92))
    tmp = tempfile.mkdtemp(prefix="kcedit_")
    parts = []
    logo = plan.get("logo")
    if plan.get("hook"):
        h = dict(plan["hook"]); h.pop("label", None); h.pop("tag", None)
        parts += render_shot(h, os.path.join(tmp, "000_hook"), beat)
        print("  hook ok", flush=True)
    if plan.get("intro"):
        p = os.path.join(tmp, "001_intro.mp4"); i = plan["intro"]
        render_card(i.get("title", ""), i.get("sub", ""), i.get("beats", 4) * beat, p, logo); parts.append(p)
    for n, s in enumerate(plan["shots"], 1):
        parts += render_shot(s, os.path.join(tmp, f"{n+1:03d}"), beat)
        print(f"  shot {n:02d} {s.get('label','')} {s.get('tag','')}{' [ramp]' if s.get('ramp') else ''} ok", flush=True)
    if plan.get("outro"):
        p = os.path.join(tmp, "999_outro.mp4"); o = plan["outro"]
        render_card(o.get("title", "KCKILLS.COM"), o.get("sub", ""), o.get("beats", 4) * beat, p, logo); parts.append(p)
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    concat = os.path.join(tmp, "concat.mp4")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", concat])
    music, cdb = plan.get("music"), plan.get("caster_db", -14)
    if music and os.path.exists(music):
        off = float(plan.get("music_offset", 0.0))
        caster = (f"[0:a]volume={cdb}dB[c];[1:a][c]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=9[a]"
                  if cdb is not None else "[1:a]loudnorm=I=-14:TP=-1.5:LRA=9[a]")
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", concat, "-ss", f"{off:.3f}", "-i", music,
             "-filter_complex", caster, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out_path])
    else:
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", concat, "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out_path])
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out_path], capture_output=True, text=True).stdout.strip() or 0)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"OK {out_path} — {dur:.1f}s, {len(parts)} segments")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
