import type { AgentMessage } from "./types.js";

// SIMULATED: Full test conversation for a MemoryArena "Constraint Propagation" eval.
// This represents a realistic multi-session agent run where the agent must remember
// product attributes across sessions to make compatible purchasing decisions.
//
// Structure: 3 sessions, ~70 messages, ~25K tokens of content.
// Session 1: Research and buy a camera body (establish constraints)
// Session 2: Find compatible lens (recall mount type, sensor size)
// Session 3: Find compatible accessories (recall battery type, card slots, body dimensions)
//
// Each session includes: user messages, memory_search tool calls with results,
// memory_write operations, web_search tool usage, and assistant reasoning.

function ts(sessionNum: number, minutesIn: number): string {
  // Session 1 starts 3 hours ago, Session 2 starts 2 hours ago, Session 3 starts 1 hour ago
  const baseMs = Date.now() - (4 - sessionNum) * 3600_000;
  return new Date(baseMs + minutesIn * 60_000).toISOString();
}

export const SIM_MESSAGES: AgentMessage[] = [
  // =========================================================================
  // SESSION 1: Camera Body Research & Purchase
  // =========================================================================
  {
    id: "s1-01", timestamp: ts(1, 0), role: "system", tokenCount: 180,
    content: `[Session Start] Agent: native-baseline | Variant: native-0d | Eval: constraint-propagation-eval-017
Task: Bundled Web Shopping — Camera Kit (3 sessions, 8 subtasks)
Session 1 of 3: Research and select a mirrorless camera body.
Constraints: Budget $2000-3000, must support 4K60 video, weather sealed, dual card slots.
[Memory loaded: MEMORY.md (42 lines), memory/2026-03-07.md (0 lines — new day)]`,
  },
  {
    id: "s1-02", timestamp: ts(1, 0.1), role: "user", tokenCount: 45,
    content: "I need to buy a mirrorless camera body for professional video work. Budget is $2000-3000. Must have 4K60 video, weather sealing, and dual card slots. What are the best options right now?",
  },
  {
    id: "s1-03", timestamp: ts(1, 0.2), role: "tool", tokenCount: 85,
    content: `[memory_search(query="camera recommendations mirrorless video")]
Results: 0 matches.
No prior camera research found in memory.`,
  },
  {
    id: "s1-04", timestamp: ts(1, 0.3), role: "tool", tokenCount: 320,
    content: `[web_search(query="best mirrorless camera body 4K60 video 2026 under $3000 weather sealed dual card slots")]
Results:
1. Sony A7IV - $2,498 - Full frame, 4K60, weather sealed, dual SD/CFexpress slots, Sony E-mount
2. Canon R6 Mark III - $2,799 - Full frame, 4K60 120fps, weather sealed, dual SD UHS-II slots, Canon RF mount
3. Nikon Z6 III - $2,499 - Full frame, 4K60 with N-Log, weather sealed, dual CFexpress Type B + SD, Nikon Z mount
4. Panasonic S5 IIX - $2,199 - Full frame, 4K60 unlimited, weather sealed, dual SD slots, L-mount
5. Fujifilm X-H2S - $2,499 - APS-C, 4K120, weather sealed, dual CFexpress/SD, Fuji X mount`,
  },
  {
    id: "s1-05", timestamp: ts(1, 1), role: "assistant", tokenCount: 380,
    content: `Based on your requirements (4K60, weather sealing, dual card slots, $2000-3000), here are the top contenders:

**Sony A7IV ($2,498)** — The most versatile option. Full-frame 33MP sensor, 4K60 from oversampled 7K readout, BIONZ XR processor. Sony E-mount has the largest third-party lens ecosystem. Dual card slots (1x CFexpress Type A, 1x SD UHS-II). Real-time Eye AF works in video. The E-mount compatibility means you can adapt virtually any lens system. 10-bit 4:2:2 internal recording. Weather sealed magnesium alloy body.

**Canon R6 Mark III ($2,799)** — Strongest autofocus system. 24.2MP full frame, 4K60 uncropped with Canon Log 3. Dual SD UHS-II slots. RF mount is newer with fewer native options but Canon's own RF glass is exceptional. IBIS up to 8 stops.

**Nikon Z6 III ($2,499)** — Best color science for video. Expeed 7 processor, N-Log and HLG support. Dual slots but note: one is CFexpress Type B (larger, more expensive cards). Nikon Z mount has a growing but still smaller lens ecosystem.

**My recommendation: Sony A7IV.** The E-mount lens ecosystem is unmatched — you'll have the most flexibility in Sessions 2 and 3 when selecting compatible lenses and accessories. The CFexpress Type A + SD dual slot setup gives good flexibility. The price leaves room in your budget for premium glass.

Want me to go with the Sony A7IV?`,
  },
  {
    id: "s1-06", timestamp: ts(1, 2), role: "user", tokenCount: 18,
    content: "Yes, let's go with the Sony A7IV. Please finalize the purchase.",
  },
  {
    id: "s1-07", timestamp: ts(1, 2.2), role: "tool", tokenCount: 190,
    content: `[web_action(action="add_to_cart", product="Sony A7IV Camera Body")]
Product added to cart:
- Sony A7IV Mirrorless Camera Body (ILCE-7M4)
- Price: $2,498.00
- SKU: SONY-A7M4-BODY
- Specs confirmed:
  Mount: Sony E-mount (full frame FE)
  Sensor: 33MP Exmor R CMOS, 35.6 x 23.8mm (full frame)
  Processor: BIONZ XR
  Video: 4K60 (7K oversampled), 10-bit 4:2:2
  Card Slots: Slot 1 CFexpress Type A / SD, Slot 2 SD UHS-II
  Battery: NP-FZ100 (Z-series)
  Dimensions: 131.3 x 96.4 x 79.8mm
  Weight: 658g (body only)
  Weather sealing: Yes (dust/moisture resistant)
  IBIS: 5-axis, 5.5 stops`,
  },
  {
    id: "s1-08", timestamp: ts(1, 2.5), role: "tool", tokenCount: 145,
    content: `[memory_write(file="memory/2026-03-07.md", action="append")]
Written to memory:
---
## Camera Purchase — Session 1

Selected: **Sony A7IV** (ILCE-7M4) — $2,498.00

### Key Specs for Compatibility (needed in later sessions):
- **Mount**: Sony E-mount (full frame FE compatible)
- **Sensor**: Full frame (35.6 x 23.8mm), 33MP Exmor R CMOS
- **Card Slot 1**: CFexpress Type A / SD UHS-I/II
- **Card Slot 2**: SD UHS-I/II only
- **Battery**: NP-FZ100 (Z-series lithium ion)
- **Dimensions**: 131.3 x 96.4 x 79.8mm
- **Weight**: 658g body only
- **Video**: 4K60p 10-bit 4:2:2, S-Log3/S-Gamut3.Cine
- **Hot shoe**: Multi Interface Shoe (MI shoe)
- **Thread**: 1/4"-20 tripod mount

Budget remaining: $502-1502 for lens + accessories.
---`,
  },
  {
    id: "s1-09", timestamp: ts(1, 3), role: "assistant", tokenCount: 210,
    content: `Done! I've purchased the Sony A7IV ($2,498) and saved all the critical compatibility specs to memory. Here's what I stored for our next sessions:

**For lens shopping (Session 2):**
- Mount type: Sony E-mount (full frame FE)
- Sensor size: Full frame (35.6 x 23.8mm) — this determines which lenses give you full coverage vs. crop

**For accessories (Session 3):**
- Card slots: CFexpress Type A + SD UHS-II (we'll need compatible cards)
- Battery: NP-FZ100 (for spare batteries / grip compatibility)
- Hot shoe: Multi Interface (MI) — for microphones, lights, monitors
- Dimensions/weight: 131.3 x 96.4 x 79.8mm, 658g — for cage/rig sizing

**Budget remaining: $502-1,502** depending on where in the $2K-3K range we're targeting.

The E-mount ecosystem is huge, so we'll have excellent options for lenses. Ready to move to lens selection whenever you are.`,
  },
  {
    id: "s1-10", timestamp: ts(1, 4), role: "user", tokenCount: 32,
    content: "Great. One more thing — I primarily shoot interviews and documentary-style content. Keep that in mind for lens selection. That's all for now.",
  },
  {
    id: "s1-11", timestamp: ts(1, 4.2), role: "tool", tokenCount: 68,
    content: `[memory_write(file="memory/2026-03-07.md", action="append")]
Written to memory:
---
### Use Case Context:
- Primary use: interviews and documentary-style video
- Implications for lens selection: need good bokeh for interviews (fast aperture f/1.4-2.8), versatile zoom range for documentary, smooth autofocus tracking
---`,
  },
  {
    id: "s1-12", timestamp: ts(1, 4.5), role: "assistant", tokenCount: 65,
    content: "Noted — interviews and documentary work. I've saved that context. For interviews you'll want a fast prime (something like an 85mm f/1.4 for beautiful subject separation), and for documentary a versatile zoom. We'll cover both in the lens session. Talk soon!",
  },

  // =========================================================================
  // SESSION 2: Compatible Lens Selection
  // =========================================================================
  {
    id: "s2-01", timestamp: ts(2, 0), role: "system", tokenCount: 95,
    content: `[Session Start] Agent: native-baseline | Eval: constraint-propagation-eval-017
Session 2 of 3: Select compatible lens for the camera purchased in Session 1.
[Memory loaded: MEMORY.md (42 lines), memory/2026-03-07.md (38 lines)]`,
  },
  {
    id: "s2-02", timestamp: ts(2, 0.1), role: "user", tokenCount: 28,
    content: "I'm ready to pick a lens for the camera I bought last session. I want something versatile for my work. What do you recommend?",
  },
  {
    id: "s2-03", timestamp: ts(2, 0.3), role: "tool", tokenCount: 210,
    content: `[memory_search(query="camera purchase lens mount type specs")]
Results (3 matches):
1. memory/2026-03-07.md:5-15 (score: 0.94)
   "Selected: Sony A7IV (ILCE-7M4) — $2,498.00 ... Mount: Sony E-mount (full frame FE compatible) ... Sensor: Full frame (35.6 x 23.8mm)"
2. memory/2026-03-07.md:22-26 (score: 0.82)
   "Budget remaining: $502-1502 for lens + accessories."
3. memory/2026-03-07.md:28-32 (score: 0.78)
   "Primary use: interviews and documentary-style video ... need good bokeh for interviews (fast aperture f/1.4-2.8), versatile zoom range for documentary"`,
  },
  {
    id: "s2-04", timestamp: ts(2, 0.5), role: "assistant", tokenCount: 120,
    content: `Let me recall your setup. You bought a **Sony A7IV** with a **Sony E-mount** (full frame FE) and a **full frame sensor**. Your budget remaining is **$502-1,502**, and you shoot **interviews and documentary content**.

For your use case, I'd recommend looking at two lens categories:
1. A fast prime for interviews (shallow depth of field, beautiful bokeh)
2. A versatile zoom for documentary work (flexibility in unpredictable situations)

Let me search for the best options in your mount and budget. All lenses must be **Sony E-mount compatible** (native FE or adapted) and **cover full frame** (no APS-C only lenses, which would vignette on your sensor).`,
  },
  {
    id: "s2-05", timestamp: ts(2, 1), role: "tool", tokenCount: 380,
    content: `[web_search(query="best Sony E-mount full frame lens interview documentary video 2026 under $1500")]
Results:
1. Sony FE 24-70mm f/2.8 GM II - $2,298 - OVER BUDGET
2. Tamron 28-75mm f/2.8 Di III VXD G2 - $879 - E-mount native, full frame, great AF
3. Sony FE 50mm f/1.4 GM - $1,298 - Prime, incredible bokeh, native E-mount
4. Sigma 24-70mm f/2.8 DG DN Art - $1,099 - E-mount native, full frame, excellent optics
5. Sony FE 85mm f/1.4 GM II - $1,798 - OVER BUDGET
6. Tamron 35-150mm f/2-2.8 Di III VXD - $1,699 - OVER BUDGET (but incredible range)
7. Sigma 35mm f/1.4 DG DN Art - $899 - E-mount native, full frame, fast AF
8. Sony FE 24-105mm f/4 G OSS - $1,098 - Versatile range but f/4 (slower)

Compatible mount filter: All results are Sony E-mount native (no adapter needed).
Full frame filter: All results cover full frame sensor.

[web_search(query="Sony FE lens compatibility A7IV autofocus video performance")]
Additional compatibility notes:
- All Sony FE and third-party E-mount lenses support full phase-detect AF on A7IV
- Sigma Art lenses: full compatibility confirmed, firmware updates via USB dock
- Tamron Di III lenses: full native compatibility, no adapter needed
- Adapted A-mount lenses via LA-EA5: AF works but slower, not recommended for video`,
  },
  {
    id: "s2-06", timestamp: ts(2, 2), role: "assistant", tokenCount: 450,
    content: `Here are the best options within your remaining budget ($502-1,502), all confirmed compatible with your Sony A7IV (E-mount, full frame):

### For the Documentary/Versatile Zoom:

**Sigma 24-70mm f/2.8 DG DN Art — $1,099** ⭐ My top pick
- Native Sony E-mount, full frame coverage
- Constant f/2.8 — fast enough for shallow DOF in interviews at the long end
- 24-70mm covers wide establishing shots through medium interview framing
- Excellent optical quality, minimal focus breathing
- Full phase-detect AF compatibility with A7IV
- Leaves $403-903 in budget for accessories

**Tamron 28-75mm f/2.8 Di III VXD G2 — $879** Budget-friendly alternative
- Native E-mount, full frame
- Slightly narrower range (28mm vs 24mm on the wide end)
- f/2.8 constant, very good AF performance
- Smaller and lighter than the Sigma
- Leaves $623-1,123 in budget

**Sony FE 24-105mm f/4 G OSS — $1,098** Range over speed
- Huge versatile range, but f/4 means less background separation
- Built-in OSS (works with A7IV's IBIS for extra stabilization)
- Better for pure documentary where you can't swap lenses

### For a Dedicated Interview Prime:

**Sigma 35mm f/1.4 DG DN Art — $899** ⭐ Best value prime
- f/1.4 gives gorgeous background separation for interviews
- 35mm is slightly wide — shows environment, good for "in-context" interviews
- Would pair perfectly with the Sigma 24-70 for a two-lens kit

**Sony FE 50mm f/1.4 GM — $1,298** Premium pick
- Classic interview focal length
- Incredibly smooth bokeh (GM designation = top-tier optics)
- f/1.4 is outstanding for subject isolation
- But leaves very little budget for accessories

### My Recommendation:

Go with the **Sigma 24-70mm f/2.8 DG DN Art ($1,099)**. It covers the most ground for both interview and documentary work. At 70mm f/2.8 you get solid subject separation for interviews, and 24mm gives you those wide documentary establishing shots. It's one lens that handles 80% of your shooting scenarios.

This leaves $403-903 for accessories in Session 3 — enough for memory cards, a spare battery, and potentially a small light or microphone.

If you want a two-lens kit, pair it with the Sigma 35mm f/1.4 Art ($899) — but that would push you to $1,998 for lenses alone, eating into accessory budget.

Which direction would you like to go?`,
  },
  {
    id: "s2-07", timestamp: ts(2, 3), role: "user", tokenCount: 42,
    content: "The Sigma 24-70 f/2.8 sounds perfect as my primary lens. Let's go with that. I do a lot of run-and-gun documentary work so the versatility is key. Save the prime for a future purchase.",
  },
  {
    id: "s2-08", timestamp: ts(2, 3.3), role: "tool", tokenCount: 165,
    content: `[web_action(action="add_to_cart", product="Sigma 24-70mm f/2.8 DG DN Art for Sony E")]
Product added to cart:
- Sigma 24-70mm f/2.8 DG DN Art (Sony E-mount)
- Price: $1,099.00
- SKU: SIGMA-2470-28-ART-SE
- Specs confirmed:
  Mount: Sony E-mount (native, no adapter)
  Coverage: Full frame (43.3mm image circle)
  Aperture: f/2.8 constant
  Focus: Stepping motor (STM), compatible with A7IV phase-detect AF
  Filter thread: 82mm
  Weight: 830g
  Length: 124.2mm
  Minimum focus: 18cm (wide), 38cm (tele)
  Weather sealing: Yes (dust/splash resistant)
  Focus breathing: Minimal (firmware v2.0+)`,
  },
  {
    id: "s2-09", timestamp: ts(2, 3.5), role: "tool", tokenCount: 125,
    content: `[memory_write(file="memory/2026-03-07.md", action="append")]
Written to memory:
---
## Lens Purchase — Session 2

Selected: **Sigma 24-70mm f/2.8 DG DN Art** (Sony E-mount) — $1,099.00

### Key Specs:
- **Mount**: Sony E-mount native (confirmed compatible with A7IV)
- **Coverage**: Full frame (matches A7IV sensor)
- **Filter thread**: 82mm (needed for filters/accessories)
- **Weight**: 830g
- **Weather sealed**: Yes
- **Focus**: Phase-detect AF compatible with A7IV

### Budget Status:
- Camera body: $2,498
- Lens: $1,099
- Total spent: $3,597
- Original budget: $2,000-3,000
- **Over budget by $597** — but within reasonable range for this quality level
- Remaining for accessories: need to be conservative
---`,
  },
  {
    id: "s2-10", timestamp: ts(2, 4), role: "assistant", tokenCount: 185,
    content: `Purchased! The **Sigma 24-70mm f/2.8 DG DN Art** ($1,099) is confirmed compatible with your A7IV — native E-mount, full frame coverage, and full phase-detect AF support.

**Kit so far:**
- Sony A7IV body — $2,498
- Sigma 24-70mm f/2.8 Art — $1,099
- **Total: $3,597**

I should flag that we're now $597 over the original $3,000 ceiling. For Session 3 accessories, I'll prioritize the essentials:
1. Memory cards (you need CFexpress Type A for 4K60 recording in Slot 1)
2. A spare NP-FZ100 battery (the A7IV drains faster during 4K video)
3. Maybe a basic accessory if budget allows

I've saved the lens specs and the 82mm filter thread to memory — that's important for any filters or lens accessories. The weather sealing on both the body and lens means we don't need a rain cover for light outdoor documentary work.

Ready for accessory shopping whenever you are!`,
  },
  {
    id: "s2-11", timestamp: ts(2, 5), role: "user", tokenCount: 15,
    content: "Perfect. Let's wrap up this session. I'll come back for accessories.",
  },
  {
    id: "s2-12", timestamp: ts(2, 5.2), role: "assistant", tokenCount: 42,
    content: "Sounds good. I've saved everything we need for the accessory session — card slot types, battery model, filter thread, and the budget situation. See you next time!",
  },

  // =========================================================================
  // SESSION 3: Compatible Accessories
  // =========================================================================
  {
    id: "s3-01", timestamp: ts(3, 0), role: "system", tokenCount: 95,
    content: `[Session Start] Agent: native-baseline | Eval: constraint-propagation-eval-017
Session 3 of 3: Select compatible accessories for camera + lens purchased in Sessions 1-2.
[Memory loaded: MEMORY.md (42 lines), memory/2026-03-07.md (76 lines)]`,
  },
  {
    id: "s3-02", timestamp: ts(3, 0.1), role: "user", tokenCount: 35,
    content: "I'm back to finish the camera kit. I need memory cards, a spare battery, and if budget allows, a small on-camera LED light for interviews. What works with my setup?",
  },
  {
    id: "s3-03", timestamp: ts(3, 0.3), role: "tool", tokenCount: 285,
    content: `[memory_search(query="camera card slots battery type specifications")]
Results (4 matches):
1. memory/2026-03-07.md:8-12 (score: 0.96)
   "Card Slot 1: CFexpress Type A / SD UHS-I/II ... Card Slot 2: SD UHS-I/II only ... Battery: NP-FZ100 (Z-series lithium ion)"
2. memory/2026-03-07.md:14-16 (score: 0.88)
   "Hot shoe: Multi Interface Shoe (MI shoe) ... Thread: 1/4-20 tripod mount"
3. memory/2026-03-07.md:40-44 (score: 0.82)
   "Total spent: $3,597 ... Over budget by $597 ... Remaining for accessories: need to be conservative"
4. memory/2026-03-07.md:5-6 (score: 0.76)
   "Selected: Sony A7IV (ILCE-7M4) ... Dimensions: 131.3 x 96.4 x 79.8mm"`,
  },
  {
    id: "s3-04", timestamp: ts(3, 0.5), role: "assistant", tokenCount: 165,
    content: `Let me pull up your setup details from memory:

**Card requirements:**
- Slot 1: CFexpress Type A (or SD) — for 4K60 recording, CFexpress Type A is strongly recommended for the sustained write speeds
- Slot 2: SD UHS-I/II — backup or overflow recording

**Battery:** NP-FZ100 (Sony Z-series)

**Hot shoe:** Multi Interface (MI) — important for LED light compatibility. Sony's MI shoe is proprietary, so we need either a Sony-branded light or one with a standard cold shoe + MI adapter.

**Budget situation:** Already $597 over the $3,000 target. We need to keep accessories minimal — let's aim for under $300 total.

Let me search for the best options.`,
  },
  {
    id: "s3-05", timestamp: ts(3, 1), role: "tool", tokenCount: 350,
    content: `[web_search(query="CFexpress Type A memory card best value 2026 Sony A7IV 4K60")]
Results:
1. Sony CEA-G160T CFexpress Type A - 160GB - $188 - 800MB/s read, 700MB/s write
2. Sony CEA-G80T CFexpress Type A - 80GB - $108 - 800MB/s read, 700MB/s write
3. ProGrade Digital CFexpress Type A - 160GB - $169 - 800MB/s read, 700MB/s write
4. Lexar CFexpress Type A Gold - 160GB - $149 - 900MB/s read, 800MB/s write ⭐ NEW

IMPORTANT: CFexpress Type A is physically different from Type B (used by Nikon).
Do NOT confuse with CFexpress Type B — they are NOT compatible with the A7IV.
Type A: 20 x 28 x 2.8mm (smaller)
Type B: 29.6 x 38.5 x 3.8mm (larger, used by Nikon Z, Canon R5)

[web_search(query="Sony NP-FZ100 battery genuine spare 2026 price")]
Results:
1. Sony NP-FZ100 (genuine) - $78 - 2280mAh, ~120min 4K recording
2. Wasabi Power NP-FZ100 (2-pack) - $29.99 - third-party, decent reviews but some report shorter life
3. RAVPower NP-FZ100 (2-pack + charger) - $45.99 - third-party, USB-C charger included

[web_search(query="small on-camera LED light Sony MI hot shoe interview 2026 under $100")]
Results:
1. Sony HVL-LEIR1 - $89 - Native MI shoe, infrared + visible, video-optimized
2. Aputure MC Pro - $129 - OVER BUDGET individually but excellent; cold shoe mount
3. Ulanzi VL49 Pro - $29.99 - Compact, cold shoe, magnetic, 2500K-9000K
4. Litra LitraPro - $89 - Compact, cold shoe, waterproof, excellent CRI`,
  },
  {
    id: "s3-06", timestamp: ts(3, 2), role: "assistant", tokenCount: 420,
    content: `Here's my recommended accessory kit, prioritized by necessity:

### Essential: Memory Cards

**CFexpress Type A (Slot 1):**
**Lexar CFexpress Type A Gold 160GB — $149** ⭐ Best value
- 900/800 MB/s read/write — exceeds A7IV's 4K60 requirements (needs ~600MB/s sustained)
- 160GB = approximately 40 minutes of 4K60 XAVC S-I recording
- ⚠️ Critical: Must be **Type A**, not Type B. Type B cards are physically larger and will NOT fit the A7IV's slot.

**SD UHS-II (Slot 2):**
**SanDisk Extreme Pro 128GB SDXC UHS-II — $24.99**
- 300MB/s read, 260MB/s write
- Perfect for Slot 2 backup/overflow recording
- Not fast enough for 4K60 in S-I mode, but fine for XAVC S and proxy recording

### Essential: Spare Battery

**Sony NP-FZ100 (genuine) — $78**
- Going genuine here. Third-party batteries sometimes cause issues with the A7IV's battery info display and can have inconsistent capacity. For professional shoot reliability, genuine Sony is worth the premium.
- 2280mAh = ~120 minutes of 4K recording (varies with IBIS usage, AF mode, screen brightness)

### Nice-to-have: LED Light

**Ulanzi VL49 Pro — $29.99** Best budget option
- 2500K-9000K color temperature range (great for matching any ambient light)
- CRI 95+ (important for skin tones in interviews)
- Cold shoe mount — attaches to the A7IV's MI hot shoe via the standard shoe adapter (the MI shoe accepts standard cold shoe accessories)
- Magnetic back — can also be placed on stands or metal surfaces
- USB-C rechargeable, ~90 min at full power
- Tiny and lightweight — won't unbalance the camera for handheld documentary work

### Budget Summary

| Item | Cost |
|------|------|
| Lexar CFexpress Type A 160GB | $149 |
| SanDisk Extreme Pro SD 128GB | $25 |
| Sony NP-FZ100 battery | $78 |
| Ulanzi VL49 Pro LED | $30 |
| **Accessories total** | **$282** |
| **Full kit total** | **$3,879** |

We're $879 over the original $3,000 ceiling, but $121 under a $4,000 stretch budget. The core kit (body + lens + cards + battery) is $3,849 without the LED.

Shall I proceed with all four items, or do you want to drop the LED light?`,
  },
  {
    id: "s3-07", timestamp: ts(3, 3), role: "user", tokenCount: 22,
    content: "Let's get all four. The LED at $30 is a no-brainer for interviews. Go ahead and add everything to cart.",
  },
  {
    id: "s3-08", timestamp: ts(3, 3.2), role: "tool", tokenCount: 230,
    content: `[web_action(action="add_to_cart", product="Lexar CFexpress Type A Gold 160GB")]
Added: Lexar CFexpress Type A Gold 160GB — $149.00
Compatibility check: ✅ CFexpress Type A fits Sony A7IV Slot 1

[web_action(action="add_to_cart", product="SanDisk Extreme Pro 128GB SDXC UHS-II")]
Added: SanDisk Extreme Pro 128GB SDXC UHS-II — $24.99
Compatibility check: ✅ SD UHS-II fits Sony A7IV Slot 2

[web_action(action="add_to_cart", product="Sony NP-FZ100 Battery")]
Added: Sony NP-FZ100 Rechargeable Battery — $78.00
Compatibility check: ✅ NP-FZ100 matches Sony A7IV battery type

[web_action(action="add_to_cart", product="Ulanzi VL49 Pro LED Light")]
Added: Ulanzi VL49 Pro On-Camera LED — $29.99
Compatibility check: ✅ Cold shoe mount compatible with A7IV MI hot shoe`,
  },
  {
    id: "s3-09", timestamp: ts(3, 3.5), role: "tool", tokenCount: 185,
    content: `[memory_write(file="memory/2026-03-07.md", action="append")]
Written to memory:
---
## Accessories Purchase — Session 3

### Items Purchased:
1. **Lexar CFexpress Type A Gold 160GB** — $149 (for Slot 1, 4K60 recording)
2. **SanDisk Extreme Pro 128GB SD UHS-II** — $25 (for Slot 2, backup)
3. **Sony NP-FZ100 battery** — $78 (spare for extended shoots)
4. **Ulanzi VL49 Pro LED** — $30 (interview lighting, cold shoe mount)

### Complete Kit:
- Sony A7IV body: $2,498
- Sigma 24-70mm f/2.8 Art: $1,099
- Accessories: $282
- **Total: $3,879**

### Compatibility Verification:
✅ Lens mount: E-mount native → A7IV E-mount
✅ Lens coverage: Full frame → A7IV full frame sensor
✅ CFexpress: Type A → A7IV Slot 1 (NOT Type B)
✅ SD card: UHS-II → A7IV Slot 2
✅ Battery: NP-FZ100 → A7IV Z-series battery bay
✅ LED mount: Cold shoe → A7IV MI hot shoe (standard shoe adapter)
✅ Weather sealing: Body + Lens both sealed
---`,
  },
  {
    id: "s3-10", timestamp: ts(3, 4), role: "assistant", tokenCount: 280,
    content: `All four accessories are in the cart. Here's your complete kit:

**Complete Camera Kit:**

| # | Item | Price | Compatibility |
|---|------|-------|---------------|
| 1 | Sony A7IV body | $2,498 | — |
| 2 | Sigma 24-70mm f/2.8 DG DN Art | $1,099 | E-mount ✅ Full frame ✅ |
| 3 | Lexar CFexpress Type A 160GB | $149 | Type A → Slot 1 ✅ |
| 4 | SanDisk Extreme Pro 128GB SD | $25 | UHS-II → Slot 2 ✅ |
| 5 | Sony NP-FZ100 spare battery | $78 | Z-series → A7IV ✅ |
| 6 | Ulanzi VL49 Pro LED light | $30 | Cold shoe → MI shoe ✅ |
| | **Total** | **$3,879** | All verified ✅ |

Every item has been verified for compatibility with your specific camera body. The critical constraint checks passed:
- **Mount compatibility**: Lens is native E-mount (no adapter needed)
- **Sensor coverage**: Lens covers full frame (no vignetting)
- **Card format**: Type A, NOT Type B (they look similar but won't physically fit)
- **Battery chemistry**: Genuine NP-FZ100, not NP-FW50 (older Sony bodies)

This kit is ready for professional interview and documentary work out of the box. The only future additions I'd suggest: an 82mm variable ND filter (matches the Sigma's filter thread) for outdoor video, and eventually that 35mm or 85mm prime for dedicated interview shots.`,
  },
  {
    id: "s3-11", timestamp: ts(3, 5), role: "system", tokenCount: 120,
    content: `[Eval Complete] constraint-propagation-eval-017
Session 3 of 3 finished.

Scoring:
- Task 1 (camera selection): ✅ PASS — selected camera meeting all constraints
- Task 2 (spec storage): ✅ PASS — stored mount, sensor, card slots, battery type
- Task 3 (lens mount compatibility): ✅ PASS — E-mount lens for E-mount body
- Task 4 (lens sensor coverage): ✅ PASS — full frame lens for full frame sensor
- Task 5 (card type compatibility): ✅ PASS — CFexpress Type A (not Type B) for A7IV
- Task 6 (battery compatibility): ✅ PASS — NP-FZ100 matches
- Task 7 (hot shoe compatibility): ✅ PASS — cold shoe on MI mount
- Task 8 (budget tracking): ⚠️ PARTIAL — exceeded original budget ceiling

Score: 7.5/8 (93.75%)
Memory operations: 4 writes, 3 searches
Cross-session recall accuracy: 100% (all stored facts correctly retrieved)`,
  },
  {
    id: "s3-12", timestamp: ts(3, 5.5), role: "assistant", tokenCount: 55,
    content: "The eval is complete! We scored 7.5/8 — all compatibility constraints passed perfectly. The only partial mark was on budget tracking (we went over the original ceiling, though the purchases were all justified). Memory recall was 100% — every spec stored in Session 1 was correctly retrieved and used in Sessions 2 and 3.",
  },
];

// ---------------------------------------------------------------------------
// Memory graph data reflecting the simulation's memory state
// ---------------------------------------------------------------------------

export const SIM_MEMORY_GRAPH = {
  nodes: [
    { id: "core", label: "MEMORY.md", type: "core" as const, size: 35, itemCount: 42 },
    { id: "daily-0307", label: "2026-03-07.md", type: "daily" as const, size: 55, itemCount: 114 },
    { id: "topic-camera", label: "Camera Specs", type: "topic" as const, size: 30, itemCount: 18 },
    { id: "topic-lens", label: "Lens Specs", type: "topic" as const, size: 22, itemCount: 12 },
    { id: "topic-accessories", label: "Accessories", type: "topic" as const, size: 20, itemCount: 8 },
    { id: "topic-budget", label: "Budget Track", type: "topic" as const, size: 15, itemCount: 5 },
    { id: "topic-usecase", label: "Use Case", type: "topic" as const, size: 12, itemCount: 3 },
    { id: "fact-mount", label: "E-mount (FE)", type: "fact" as const, size: 18, itemCount: 4 },
    { id: "fact-sensor", label: "Full Frame", type: "fact" as const, size: 16, itemCount: 3 },
    { id: "fact-cards", label: "CFexA + SD", type: "fact" as const, size: 14, itemCount: 3 },
    { id: "fact-battery", label: "NP-FZ100", type: "fact" as const, size: 12, itemCount: 2 },
    { id: "fact-hotshoe", label: "MI Shoe", type: "fact" as const, size: 10, itemCount: 2 },
  ],
  edges: [
    { source: "core", target: "daily-0307", weight: 0.9 },
    { source: "daily-0307", target: "topic-camera", weight: 0.95 },
    { source: "daily-0307", target: "topic-lens", weight: 0.9 },
    { source: "daily-0307", target: "topic-accessories", weight: 0.85 },
    { source: "daily-0307", target: "topic-budget", weight: 0.7 },
    { source: "daily-0307", target: "topic-usecase", weight: 0.6 },
    { source: "topic-camera", target: "fact-mount", weight: 0.95 },
    { source: "topic-camera", target: "fact-sensor", weight: 0.9 },
    { source: "topic-camera", target: "fact-cards", weight: 0.85 },
    { source: "topic-camera", target: "fact-battery", weight: 0.8 },
    { source: "topic-camera", target: "fact-hotshoe", weight: 0.75 },
    { source: "topic-lens", target: "fact-mount", weight: 0.95 },
    { source: "topic-lens", target: "fact-sensor", weight: 0.85 },
    { source: "topic-accessories", target: "fact-cards", weight: 0.9 },
    { source: "topic-accessories", target: "fact-battery", weight: 0.9 },
    { source: "topic-accessories", target: "fact-hotshoe", weight: 0.8 },
    { source: "fact-mount", target: "fact-sensor", weight: 0.4 },
  ],
};
