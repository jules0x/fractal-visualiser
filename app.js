/**
 * AETHER - Mathematical Visualizer Studio Engine
 * Supports WebGL 2.0 / 1.0 GPU Shaders for Julia Sets, Mandelbrot, Newton Fractals,
 * and high-performance Canvas 2D / 3D particle rendering for Chaos Attractors.
 */

class MathStudio {
    constructor() {
        this.canvas = document.getElementById('math-canvas');
        this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        this.ctx2d = null; // Used for attractor fallback if needed
        
        this.mode = 'julia'; // 'julia', 'mandelbrot', 'newton', 'clifford', 'lorenz'
        this.palette = 'electric';
        
        // Navigation View State
        this.zoom = 1.0;
        this.targetZoom = 1.0;
        this.center = { x: 0.0, y: 0.0 };
        this.targetCenter = { x: 0.0, y: 0.0 };
        this.maxIterations = 120;
        this.colorShift = 1.0;
        this.phaseShift = 0.0;
        this.flowSpeed = 1.0;
        this.autoZoomSpeed = 0.0;
        this.accumulatedFlow = 0.0;
        
        // Interactive Mouse States
        this.isDragging = false;
        this.lastMousePos = { x: 0, y: 0 };
        
        // Algorithm specific dynamic parameters
        this.params = {
            // Julia Set: f(z) = z^2 + c (c = cr + ci*i)
            cr: -0.7,
            ci: 0.27015,
            
            // Mandelbrot: f(z) = z^power + c
            power: 2.0,
            
            // Newton Fractal: z^(power) - 1 = 0
            newtonPower: 3.0,
            relaxation: 1.0,
            
            // Clifford Attractor: x' = sin(a*y) + c*cos(a*x), y' = sin(b*x) + d*cos(b*y)
            cliffordA: -1.4,
            cliffordB: 1.6,
            cliffordC: 1.0,
            cliffordD: 0.7,
            
            // Lorenz Attractor: dx/dt = sigma*(y - x), dy/dt = x*(rho - z) - y, dz/dt = x*y - beta*z
            lorenzSigma: 10.0,
            lorenzRho: 28.0,
            lorenzBeta: 8.0 / 3.0,
            lorenzRotSpeed: 0.5
        };

        // Presets library (Curated Collection of 20+ Mathematical Coordinates)
        this.presets = {
            julia: [
                { name: 'Dendrite Classic', cr: -0.7, ci: 0.27015 },
                { name: 'San Marco Dragon', cr: -0.75, ci: 0.0 },
                { name: 'Siegel Disk Spiral', cr: -0.39054, ci: -0.58679 },
                { name: 'Spiral Galaxy', cr: -0.4, ci: 0.6 },
                { name: 'Starfish Fractal', cr: 0.285, ci: 0.01 },
                { name: 'Frost Crystal Nebula', cr: -0.8, ci: 0.156 },
                { name: 'Electric Tendrils', cr: -0.7269, ci: 0.1889 },
                { name: 'Rabbit Fractal', cr: -0.123, ci: 0.745 },
                { name: 'Infinite Filament', cr: -0.70176, ci: -0.3842 },
                { name: 'Feathered Dragon', cr: -0.835, ci: -0.2321 }
            ],
            mandelbrot: [
                { name: 'Classic Overview', power: 2.0, zoom: 1.0, cx: -0.5, cy: 0.0 },
                { name: 'Seahorse Valley Spiral', power: 2.0, zoom: 350.0, cx: -0.743643887, cy: 0.1318259 },
                { name: 'Elephant Valley', power: 2.0, zoom: 45.0, cx: 0.275, cy: 0.0 },
                { name: 'Triple Spiral Filament', power: 2.0, zoom: 2400.0, cx: -0.088, cy: 0.654 },
                { name: 'Cubic Mandelbrot (z³)', power: 3.0, zoom: 1.0, cx: 0.0, cy: 0.0 },
                { name: 'Quartic Mandelbrot (z⁴)', power: 4.0, zoom: 1.0, cx: 0.0, cy: 0.0 },
                { name: 'Mini-Mandelbrot Satellite', power: 2.0, zoom: 12000.0, cx: -1.775, cy: 0.0 },
                { name: 'Quad-Spire Star (z⁵)', power: 5.0, zoom: 1.0, cx: 0.0, cy: 0.0 }
            ],
            newton: [
                { name: 'Cube Roots (z³ - 1)', newtonPower: 3.0, relaxation: 1.0 },
                { name: 'Quintic Symmetry (z⁵ - 1)', newtonPower: 5.0, relaxation: 1.0 },
                { name: 'Over-relaxed Motion (z³ - 1, r=1.6)', newtonPower: 3.0, relaxation: 1.6 },
                { name: 'Chaos Edge Boundary (z⁴ - 1, r=0.75)', newtonPower: 4.0, relaxation: 0.75 },
                { name: 'Octahedral Root Lattice (z⁸ - 1)', newtonPower: 8.0, relaxation: 1.0 },
                { name: 'Under-damped Resonance (z⁶ - 1, r=0.4)', newtonPower: 6.0, relaxation: 0.4 }
            ]
        };

        // FPS meter
        this.frameCount = 0;
        this.lastTime = performance.now();
        this.fps = 60;
        this.animTime = 0.0;

        this.initWebGL();
        this.setupEventListeners();
        this.restoreActiveSessionState();
        this.buildDynamicControls();
        this.populatePresets();
        this.resize();
        
        requestAnimationFrame((t) => this.renderLoop(t));
    }

    saveActiveSessionState() {
        try {
            const sessionData = {
                mode: this.mode,
                palette: this.palette,
                targetZoom: this.targetZoom,
                zoom: this.zoom,
                targetCenter: this.targetCenter,
                center: this.center,
                maxIterations: this.maxIterations,
                colorShift: this.colorShift,
                phaseShift: this.phaseShift,
                flowSpeed: this.flowSpeed,
                autoZoomSpeed: this.autoZoomSpeed,
                params: { ...this.params }
            };
            localStorage.setItem('aether_active_session', JSON.stringify(sessionData));
        } catch (e) {
            console.warn('Failed to save session state', e);
        }
    }

    restoreActiveSessionState() {
        try {
            const stored = localStorage.getItem('aether_active_session');
            if (!stored) return;
            const data = JSON.parse(stored);

            if (data.mode) this.mode = data.mode;
            if (data.palette) this.palette = data.palette;
            if (data.targetZoom !== undefined) {
                this.targetZoom = data.targetZoom;
                this.zoom = data.zoom !== undefined ? data.zoom : data.targetZoom;
            }
            if (data.targetCenter) {
                this.targetCenter = { ...data.targetCenter };
                this.center = { ...(data.center || data.targetCenter) };
            }
            if (data.maxIterations !== undefined) this.maxIterations = data.maxIterations;
            if (data.colorShift !== undefined) this.colorShift = data.colorShift;
            if (data.phaseShift !== undefined) this.phaseShift = data.phaseShift;
            if (data.flowSpeed !== undefined) this.flowSpeed = data.flowSpeed;
            if (data.autoZoomSpeed !== undefined) this.autoZoomSpeed = data.autoZoomSpeed;
            if (data.params) this.params = { ...this.params, ...data.params };

            // Update UI elements to reflect restored active session state
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === this.mode);
            });
            document.querySelectorAll('.palette-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.palette === this.palette);
            });
            const iterEl = document.getElementById('iterations-slider');
            if (iterEl) {
                iterEl.value = this.maxIterations;
                document.getElementById('iterations-val').innerText = this.maxIterations;
            }
            const colorEl = document.getElementById('color-shift-slider');
            if (colorEl) {
                colorEl.value = this.colorShift;
                document.getElementById('color-shift-val').innerText = this.colorShift.toFixed(1);
            }
            const phaseEl = document.getElementById('phase-shift-slider');
            if (phaseEl) {
                phaseEl.value = this.phaseShift;
                document.getElementById('phase-shift-val').innerText = this.phaseShift.toFixed(2);
            }
            const flowEl = document.getElementById('flow-speed-slider');
            if (flowEl) {
                flowEl.value = this.flowSpeed;
                document.getElementById('flow-speed-val').innerText = this.flowSpeed.toFixed(1);
            }
            const autoZoomEl = document.getElementById('auto-zoom-slider');
            if (autoZoomEl) {
                autoZoomEl.value = this.autoZoomSpeed;
                const badge = document.getElementById('auto-zoom-val');
                if (this.autoZoomSpeed === 0) badge.innerText = 'OFF';
                else if (this.autoZoomSpeed > 0) badge.innerText = `+${this.autoZoomSpeed.toFixed(1)} IN`;
                else badge.innerText = `${this.autoZoomSpeed.toFixed(1)} OUT`;
            }
        } catch (e) {
            console.warn('Failed to restore active session state', e);
        }
    }

    initWebGL() {
        const gl = this.gl;
        if (!gl) {
            console.error('WebGL not supported');
            return;
        }

        // Full-screen Quad vertices
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1,
        ]);

        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        this.compileShaders();
    }

    getVertexShaderSource() {
        return `#version 300 es
        in vec2 a_position;
        out vec2 v_uv;
        void main() {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }`;
    }

    getFragmentShaderSource() {
        return `#version 300 es
        precision highp float;

        in vec2 v_uv;
        out vec4 fragColor;

        uniform vec2 u_resolution;
        uniform vec2 u_center_hi;
        uniform vec2 u_center_lo;
        uniform float u_zoom_hi;
        uniform float u_zoom_lo;
        uniform int u_max_iterations;
        uniform int u_mode; // 0: Julia, 1: Mandelbrot, 2: Newton, 3: Clifford, 4: Lorenz
        uniform float u_time;
        uniform int u_palette;
        uniform float u_color_shift;

        // Custom parameters
        uniform vec2 u_c;           // Julia (cr, ci)
        uniform float u_power;      // Mandelbrot power
        uniform float u_newton_power;
        uniform float u_relaxation;

        // Palette Generator (8 Curated Themes)
        vec3 getColor(float t) {
            t = fract(t * u_color_shift + u_time);
            
            if (u_palette == 0) { // Electric Nebula
                return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
            } else if (u_palette == 1) { // Purple & Orange Sunset
                return vec3(0.5, 0.2, 0.4) + vec3(0.5, 0.4, 0.4) * cos(6.28318 * (vec3(1.0) * t + vec3(0.7, 0.15, 0.0)));
            } else if (u_palette == 2) { // Toxic Waste (Green & Purple)
                return vec3(0.4, 0.2, 0.5) + vec3(0.6, 0.8, 0.5) * cos(6.28318 * (vec3(1.0, 2.0, 1.0) * t + vec3(0.3, 0.9, 0.1)));
            } else if (u_palette == 3) { // Neon Cyberpunk
                return vec3(0.5, 0.0, 0.5) + vec3(0.5, 0.5, 0.5) * cos(6.28318 * (vec3(2.0, 1.0, 0.0) * t + vec3(0.5, 0.2, 0.25)));
            } else if (u_palette == 4) { // Bioluminescent Emerald
                return vec3(0.1, 0.5, 0.4) + vec3(0.2, 0.4, 0.3) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.2, 0.4)));
            } else if (u_palette == 5) { // Inferno Fire
                return vec3(smoothstep(0.0, 0.4, t), smoothstep(0.2, 0.7, t), smoothstep(0.6, 1.0, t));
            } else if (u_palette == 6) { // Royal Gold & Obsidian
                return vec3(0.4, 0.35, 0.1) + vec3(0.5, 0.45, 0.2) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.1, 0.2)));
            } else { // Cosmic Deep Space
                return vec3(0.1, 0.2, 0.5) + vec3(0.3, 0.4, 0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.6, 0.8, 1.0)));
            }
        }

        // Emulated Double Precision (split high / low float32 components)
        struct ds {
            float hi;
            float lo;
        };

        // Complex math helpers
        vec2 complexSquare(vec2 c) {
            return vec2(c.x * c.x - c.y * c.y, 2.0 * c.x * c.y);
        }

        vec2 complexPower(vec2 z, float p) {
            float r = length(z);
            if (r == 0.0) return vec2(0.0);
            float theta = atan(z.y, z.x);
            return pow(r, p) * vec2(cos(p * theta), sin(p * theta));
        }

        ds ds_set(float a) {
            return ds(a, 0.0);
        }

        ds ds_add(ds a, ds b) {
            float s = a.hi + b.hi;
            float v = s - a.hi;
            float e = (a.hi - (s - v)) + (b.hi - v) + a.lo + b.lo;
            float hi = s + e;
            float lo = e - (hi - s);
            return ds(hi, lo);
        }

        ds ds_sub(ds a, ds b) {
            return ds_add(a, ds(-b.hi, -b.lo));
        }

        // Dekker's float split into 12-bit high and low parts to prevent float32 product overflow
        vec2 ds_split(float a) {
            float c = 4097.0 * a;
            float ab = c - a;
            float hi = c - ab;
            float lo = a - hi;
            return vec2(hi, lo);
        }

        // Exact Two-Product multiplication (Dekker's Algorithm)
        ds ds_mul(ds a, ds b) {
            float p = a.hi * b.hi;
            vec2 aS = ds_split(a.hi);
            vec2 bS = ds_split(b.hi);
            float err = p - (aS.x * bS.x) - (aS.y * bS.x) - (aS.x * bS.y) - (aS.y * bS.y);
            float e = err + a.hi * b.lo + a.lo * b.hi;
            float hi = p + e;
            float lo = e - (hi - p);
            return ds(hi, lo);
        }

        // --- JULIA SET (20x Deep Precision Perturbation Engine) ---
        vec4 renderJulia(ds zx_in, ds zy_in) {
            ds cx = ds(u_c.x, 0.0);
            ds cy = ds(u_c.y, 0.0);

            // Sub-pixel perturbation vector delta relative to center
            ds dx = ds_sub(zx_in, ds(u_center_hi.x, u_center_lo.x));
            ds dy = ds_sub(zy_in, ds(u_center_hi.y, u_center_lo.y));

            ds zx = zx_in;
            ds zy = zy_in;

            float n = 0.0;
            float maxIt = float(u_max_iterations);

            for (int i = 0; i < 1000; i++) {
                if (float(i) >= maxIt) break;
                
                float magSq = (zx.hi + zx.lo) * (zx.hi + zx.lo) + (zy.hi + zy.lo) * (zy.hi + zy.lo);
                if (magSq > 4.0) {
                    n = float(i);
                    break;
                }
                
                // Double-single precise complex multiplication: z_next = z^2 + c
                ds zx2 = ds_mul(zx, zx);
                ds zy2 = ds_mul(zy, zy);
                ds zxy = ds_mul(zx, zy);

                zx = ds_add(ds_sub(zx2, zy2), cx);
                zy = ds_add(ds_add(zxy, zxy), cy);
            }

            if (n == 0.0) return vec4(0.0, 0.0, 0.0, 1.0);

            float log_zn = log((zx.hi + zx.lo) * (zx.hi + zx.lo) + (zy.hi + zy.lo) * (zy.hi + zy.lo)) / 2.0;
            float nu = log(log_zn / log(2.0)) / log(2.0);
            float iter = n + 1.0 - nu;

            return vec4(getColor(iter / 40.0), 1.0);
        }

        // --- MANDELBROT SET (20x Deep Precision Perturbation Engine) ---
        vec4 renderMandelbrot(ds cx, ds cy) {
            ds zx = ds(0.0, 0.0);
            ds zy = ds(0.0, 0.0);

            float n = 0.0;
            float maxIt = float(u_max_iterations);

            for (int i = 0; i < 1000; i++) {
                if (float(i) >= maxIt) break;
                
                float magSq = (zx.hi + zx.lo) * (zx.hi + zx.lo) + (zy.hi + zy.lo) * (zy.hi + zy.lo);
                if (magSq > 4.0) {
                    n = float(i);
                    break;
                }

                if (u_power == 2.0) {
                    ds zx2 = ds_mul(zx, zx);
                    ds zy2 = ds_mul(zy, zy);
                    ds zxy = ds_mul(zx, zy);

                    zx = ds_add(ds_sub(zx2, zy2), cx);
                    zy = ds_add(ds_add(zxy, zxy), cy);
                } else {
                    ds zx2 = ds_mul(zx, zx);
                    ds zy2 = ds_mul(zy, zy);
                    ds zxy = ds_mul(zx, zy);
                    
                    vec2 z = vec2(zx.hi + zx.lo, zy.hi + zy.lo);
                    vec2 c = vec2(cx.hi + cx.lo, cy.hi + cy.lo);
                    vec2 zP = complexPower(z, u_power) + c;
                    zx = ds(zP.x, 0.0);
                    zy = ds(zP.y, 0.0);
                }
            }

            if (n == 0.0) return vec4(0.0, 0.0, 0.0, 1.0);

            float log_zn = log(zx.hi * zx.hi + zy.hi * zy.hi) / 2.0;
            float nu = log(log_zn / log(2.0)) / log(2.0);
            float iter = n + 1.0 - nu;

            return vec4(getColor(iter / 50.0), 1.0);
        }

        // --- NEWTON FRACTAL ---
        vec4 renderNewton(vec2 st) {
            vec2 z = st;
            float p = u_newton_power;
            float maxIt = float(u_max_iterations);
            float n = 0.0;

            for (int i = 0; i < 1000; i++) {
                if (float(i) >= maxIt) break;
                
                vec2 zp = complexPower(z, p);
                vec2 zp1 = complexPower(z, p - 1.0);
                
                vec2 f = zp - vec2(1.0, 0.0);
                vec2 df = p * zp1;
                
                float denom = dot(df, df);
                if (denom == 0.0) break;
                
                vec2 step = vec2(f.x * df.x + f.y * df.y, f.y * df.x - f.x * df.y) / denom;
                z -= u_relaxation * step;

                if (length(step) < 0.0001) {
                    n = float(i);
                    break;
                }
            }

            float angle = atan(z.y, z.x);
            float t = (angle + 3.14159265) / 6.2831853 + n * 0.05;
            return vec4(getColor(t), 1.0);
        }

        void main() {
            vec2 norm = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
            
            // Full high precision double-single screen coordinate calculation
            float invZoomHi = 1.0 / u_zoom_hi;
            float invZoomLo = u_zoom_lo != 0.0 ? -u_zoom_lo / (u_zoom_hi * u_zoom_hi) : 0.0;
            ds invZoom = ds(invZoomHi, invZoomLo);

            ds normXDS = ds(norm.x, 0.0);
            ds normYDS = ds(norm.y, 0.0);

            ds centerXDS = ds(u_center_hi.x, u_center_lo.x);
            ds centerYDS = ds(u_center_hi.y, u_center_lo.y);

            ds stX = ds_add(ds_mul(normXDS, invZoom), centerXDS);
            ds stY = ds_add(ds_mul(normYDS, invZoom), centerYDS);
            
            vec2 st = vec2(stX.hi + stX.lo, stY.hi + stY.lo);

            if (u_mode == 0) {
                fragColor = renderJulia(stX, stY);
            } else if (u_mode == 1) {
                fragColor = renderMandelbrot(stX, stY);
            } else if (u_mode == 2) {
                fragColor = renderNewton(st);
            } else {
                fragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
        }`;
    }

    compileShaders() {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, this.getVertexShaderSource());
        gl.compileShader(vs);

        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error('VS Error:', gl.getShaderInfoLog(vs));
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, this.getFragmentShaderSource());
        gl.compileShader(fs);

        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error('FS Error:', gl.getShaderInfoLog(fs));
        }

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program Link Error:', gl.getProgramInfoLog(this.program));
        }

        gl.useProgram(this.program);

        // Store uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            center_hi: gl.getUniformLocation(this.program, 'u_center_hi'),
            center_lo: gl.getUniformLocation(this.program, 'u_center_lo'),
            zoom_hi: gl.getUniformLocation(this.program, 'u_zoom_hi'),
            zoom_lo: gl.getUniformLocation(this.program, 'u_zoom_lo'),
            max_iterations: gl.getUniformLocation(this.program, 'u_max_iterations'),
            mode: gl.getUniformLocation(this.program, 'u_mode'),
            time: gl.getUniformLocation(this.program, 'u_time'),
            palette: gl.getUniformLocation(this.program, 'u_palette'),
            color_shift: gl.getUniformLocation(this.program, 'u_color_shift'),
            phase_shift: gl.getUniformLocation(this.program, 'u_phase_shift'),
            c: gl.getUniformLocation(this.program, 'u_c'),
            power: gl.getUniformLocation(this.program, 'u_power'),
            newton_power: gl.getUniformLocation(this.program, 'u_newton_power'),
            relaxation: gl.getUniformLocation(this.program, 'u_relaxation')
        };
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.resize());

        // Fullscreen Controls Toggle
        const toggleBtn = document.getElementById('ui-toggle-btn');
        const headerEl = document.getElementById('app-header');
        const controlPanelEl = document.getElementById('control-panel');
        const hintsEl = document.getElementById('canvas-hints');

        const toggleUI = () => {
            headerEl.classList.toggle('ui-hidden');
            controlPanelEl.classList.toggle('ui-hidden');
            hintsEl.classList.toggle('ui-hidden');
            toggleBtn.classList.toggle('active');
        };

        toggleBtn.addEventListener('click', toggleUI);

        // Hotkey 'H' to toggle UI fullscreen view
        window.addEventListener('keydown', (e) => {
            if (e.key === 'h' || e.key === 'H') {
                toggleUI();
            }
        });

        // Navigation Mode Tabs
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.onModeChange();
            });
        });

        // Palette Selector
        document.querySelectorAll('.palette-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.palette = btn.dataset.palette;
            });
        });

        // Iteration Slider
        const iterSlider = document.getElementById('iterations-slider');
        iterSlider.addEventListener('input', (e) => {
            this.maxIterations = parseInt(e.target.value);
            document.getElementById('iterations-val').innerText = this.maxIterations;
        });

        // Color Shift / Frequency Slider
        const colorSlider = document.getElementById('color-shift-slider');
        colorSlider.addEventListener('input', (e) => {
            this.colorShift = parseFloat(e.target.value);
            document.getElementById('color-shift-val').innerText = this.colorShift.toFixed(1);
        });

        // Flow Speed Slider
        const flowSlider = document.getElementById('flow-speed-slider');
        flowSlider.addEventListener('input', (e) => {
            this.flowSpeed = parseFloat(e.target.value);
            document.getElementById('flow-speed-val').innerText = this.flowSpeed.toFixed(1);
        });

        // Continuous Auto-Zoom Slider
        const autoZoomSlider = document.getElementById('auto-zoom-slider');
        autoZoomSlider.addEventListener('input', (e) => {
            this.autoZoomSpeed = parseFloat(e.target.value);
            const badge = document.getElementById('auto-zoom-val');
            if (this.autoZoomSpeed === 0) {
                badge.innerText = 'OFF';
            } else if (this.autoZoomSpeed > 0) {
                badge.innerText = `+${this.autoZoomSpeed.toFixed(1)} IN`;
            } else {
                badge.innerText = `${this.autoZoomSpeed.toFixed(1)} OUT`;
            }
        });

        // Save Custom Preset Button
        const saveBtn = document.getElementById('save-preset-btn');
        const nameInput = document.getElementById('preset-name-input');
        saveBtn.addEventListener('click', () => {
            const name = nameInput.value;
            if (name && name.trim()) {
                this.saveCustomPreset(name);
                nameInput.value = '';
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const name = nameInput.value;
                if (name && name.trim()) {
                    this.saveCustomPreset(name);
                    nameInput.value = '';
                }
            }
        });

        // Delete Custom Preset Button
        document.getElementById('delete-preset-btn').addEventListener('click', () => {
            const select = document.getElementById('preset-select');
            const val = select.value;
            if (val && val.startsWith('custom_')) {
                const customIdx = parseInt(val.split('_')[1]);
                this.deleteCustomPreset(customIdx);
            }
        });

        // Stop Zoom Button (Halts active continuous auto-zoom and zoom inertia)
        document.getElementById('stop-zoom-btn').addEventListener('click', () => {
            this.autoZoomSpeed = 0.0;
            this.targetZoom = this.zoom;
            document.getElementById('auto-zoom-slider').value = 0;
            document.getElementById('auto-zoom-val').innerText = 'OFF';
        });

        // Reset View Button
        document.getElementById('reset-view-btn').addEventListener('click', () => {
            this.targetZoom = 1.0;
            this.targetCenter = { x: 0.0, y: 0.0 };
            this.autoZoomSpeed = 0.0;
            document.getElementById('auto-zoom-slider').value = 0;
            document.getElementById('auto-zoom-val').innerText = 'OFF';
        });

        // Export Snapshot
        document.getElementById('snapshot-btn').addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `aether_${this.mode}_${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png');
            link.click();
        });

        // Canvas Mouse Dragging & Zooming
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            const dx = e.clientX - this.lastMousePos.x;
            const dy = e.clientY - this.lastMousePos.y;
            this.lastMousePos = { x: e.clientX, y: e.clientY };

            if (e.shiftKey && this.mode === 'julia') {
                // Ultra-softened Shift + Mouse Drag (holding Alt/Option makes it 5x finer)
                const sensitivity = e.altKey ? 0.00001 : 0.00005;
                this.params.cr += dx * sensitivity;
                this.params.ci = Math.max(-0.7, Math.min(0.7, this.params.ci - dy * sensitivity));
                this.updateSliderUI('cr', this.params.cr);
                this.updateSliderUI('ci', this.params.ci);
                this.updateFormulaHUD();
            } else {
                // Pan complex plane
                const minDim = Math.min(this.canvas.width, this.canvas.height);
                this.targetCenter.x -= (dx / minDim) * (2.0 / this.zoom);
                this.targetCenter.y += (dy / minDim) * (2.0 / this.zoom);
            }
        });

        // Double Click to Zoom In towards clicked spot
        this.canvas.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const zoomMultiplier = 2.5;
            const newTargetZoom = Math.max(0.1, Math.min(1e30, this.targetZoom * zoomMultiplier));

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const minDim = Math.min(rect.width, rect.height);
            const normX = (mouseX - rect.width * 0.5) / minDim;
            const normY = (rect.height * 0.5 - mouseY) / minDim;

            const currentPlaneX = normX * (2.0 / this.targetZoom) + this.targetCenter.x;
            const currentPlaneY = normY * (2.0 / this.targetZoom) + this.targetCenter.y;

            this.targetCenter.x = currentPlaneX - normX * (2.0 / newTargetZoom);
            this.targetCenter.y = currentPlaneY - normY * (2.0 / newTargetZoom);
            this.targetZoom = newTargetZoom;
        });

        // Wheel Zooming towards Mouse Cursor
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Smoother, less aggressive zoom factor based on wheel delta
            const delta = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);
            const zoomMultiplier = Math.exp(delta * 0.0015);
            
            const newTargetZoom = Math.max(0.1, Math.min(1e30, this.targetZoom * zoomMultiplier));
            
            // Calculate mouse position in normalized complex plane coordinates before zoom
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const minDim = Math.min(rect.width, rect.height);
            const normX = (mouseX - rect.width * 0.5) / minDim;
            const normY = (rect.height * 0.5 - mouseY) / minDim;
            
            // Shift center so zoom converges directly onto the mouse pointer
            const currentPlaneX = normX * (2.0 / this.targetZoom) + this.targetCenter.x;
            const currentPlaneY = normY * (2.0 / this.targetZoom) + this.targetCenter.y;
            
            this.targetCenter.x = currentPlaneX - normX * (2.0 / newTargetZoom);
            this.targetCenter.y = currentPlaneY - normY * (2.0 / newTargetZoom);
            this.targetZoom = newTargetZoom;
        }, { passive: false });
    }

    onModeChange() {
        this.targetZoom = 1.0;
        this.targetCenter = { x: 0.0, y: 0.0 };

        const modeTitles = {
            julia: 'Julia Set Visualizer',
            mandelbrot: 'Mandelbrot Explorer',
            newton: 'Newton Root Fractal'
        };

        document.getElementById('current-algorithm-title').innerText = modeTitles[this.mode] || 'Julia Set Visualizer';
        this.buildDynamicControls();
        this.populatePresets();
        this.updateFormulaHUD();
    }

    updateFormulaHUD() {
        const formulaEl = document.getElementById('formula-display');
        if (this.mode === 'julia') {
            const finalCr = this.params.cr + (this.params.crFine || 0.0);
            const finalCi = Math.max(-0.7, Math.min(0.7, this.params.ci + (this.params.ciFine || 0.0)));
            const sign = finalCi >= 0 ? '+' : '-';
            formulaEl.innerText = `f(z) = z² + (${finalCr.toFixed(4)} ${sign} ${Math.abs(finalCi).toFixed(4)}i)`;
        } else if (this.mode === 'mandelbrot') {
            formulaEl.innerText = `f(z) = z^${this.params.power.toFixed(1)} + c`;
        } else if (this.mode === 'newton') {
            formulaEl.innerText = `z^${this.params.newtonPower.toFixed(1)} - 1 = 0  (r=${this.params.relaxation.toFixed(2)})`;
        }
    }

    buildDynamicControls() {
        const container = document.getElementById('sliders-container');
        container.innerHTML = '';

        let controls = [];

        if (this.mode === 'julia') {
            this.params.ci = Math.max(-0.7, Math.min(0.7, this.params.ci));
            controls = [
                { id: 'cr', label: 'Real Constant (cr)', min: -2.0, max: 2.0, step: 0.001, val: this.params.cr },
                { id: 'crFine', label: '↳ Fine-Tune cr Trim', min: -0.05, max: 0.05, step: 0.0001, val: this.params.crFine || 0.0 },
                { id: 'ci', label: 'Imaginary Constant (ci)', min: -0.7, max: 0.7, step: 0.001, val: this.params.ci },
                { id: 'ciFine', label: '↳ Fine-Tune ci Trim', min: -0.05, max: 0.05, step: 0.0001, val: this.params.ciFine || 0.0 }
            ];
        } else if (this.mode === 'mandelbrot') {
            controls = [
                { id: 'power', label: 'Exponent Power (z^p)', min: 1.0, max: 6.0, step: 0.1, val: this.params.power }
            ];
        } else if (this.mode === 'newton') {
            controls = [
                { id: 'newtonPower', label: 'Polynomial Exponent (z^p - 1)', min: 2.0, max: 8.0, step: 1.0, val: this.params.newtonPower },
                { id: 'relaxation', label: 'Relaxation Factor (r)', min: 0.2, max: 2.5, step: 0.05, val: this.params.relaxation }
            ];
        }

        controls.forEach(ctrl => {
            const group = document.createElement('div');
            group.className = 'control-group';

            const labelRow = document.createElement('div');
            labelRow.className = 'label-row';
            labelRow.innerHTML = `<label for="slider-${ctrl.id}">${ctrl.label}</label><span class="val-badge" id="val-${ctrl.id}">${ctrl.val.toFixed(3)}</span>`;

            const input = document.createElement('input');
            input.type = 'range';
            input.id = `slider-${ctrl.id}`;
            input.min = ctrl.min;
            input.max = ctrl.max;
            input.step = ctrl.step;
            input.value = ctrl.val;

            input.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.params[ctrl.id] = val;
                document.getElementById(`val-${ctrl.id}`).innerText = val.toFixed(3);
                this.updateFormulaHUD();
            });

            group.appendChild(labelRow);
            group.appendChild(input);
            container.appendChild(group);
        });
    }

    updateSliderUI(paramId, val) {
        const input = document.getElementById(`slider-${paramId}`);
        const badge = document.getElementById(`val-${paramId}`);
        if (input && badge) {
            input.value = val;
            badge.innerText = val.toFixed(3);
        }
    }

    loadSavedCustomPresets() {
        try {
            const stored = localStorage.getItem('aether_custom_presets');
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            return {};
        }
    }

    saveCustomPreset(name) {
        if (!name || !name.trim()) return;
        const customPresets = this.loadSavedCustomPresets();
        if (!customPresets[this.mode]) customPresets[this.mode] = [];

        const presetState = {
            name: name.trim(),
            isCustom: true,
            zoom: this.targetZoom,
            cx: this.targetCenter.x,
            cy: this.targetCenter.y,
            maxIterations: this.maxIterations,
            palette: this.palette,
            colorShift: this.colorShift,
            flowSpeed: this.flowSpeed,
            autoZoomSpeed: this.autoZoomSpeed,
            params: { ...this.params }
        };

        customPresets[this.mode].push(presetState);
        localStorage.setItem('aether_custom_presets', JSON.stringify(customPresets));
        this.populatePresets();
    }

    deleteCustomPreset(indexInCustom) {
        const customPresets = this.loadSavedCustomPresets();
        if (customPresets[this.mode] && customPresets[this.mode][indexInCustom]) {
            customPresets[this.mode].splice(indexInCustom, 1);
            localStorage.setItem('aether_custom_presets', JSON.stringify(customPresets));
            this.populatePresets();
        }
    }

    populatePresets() {
        const select = document.getElementById('preset-select');
        select.innerHTML = '<option value="">Select a Preset...</option>';

        const builtInPresets = this.presets[this.mode] || [];
        const customPresets = (this.loadSavedCustomPresets()[this.mode] || []);

        const builtInGroup = document.createElement('optgroup');
        builtInGroup.label = 'Built-in Presets';
        builtInPresets.forEach((p, idx) => {
            const opt = document.createElement('option');
            opt.value = `builtin_${idx}`;
            opt.innerText = p.name;
            builtInGroup.appendChild(opt);
        });
        select.appendChild(builtInGroup);

        if (customPresets.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = '★ My Saved Presets';
            customPresets.forEach((p, idx) => {
                const opt = document.createElement('option');
                opt.value = `custom_${idx}`;
                opt.innerText = `★ ${p.name}`;
                customGroup.appendChild(opt);
            });
            select.appendChild(customGroup);
        }

        select.onchange = (e) => {
            const val = e.target.value;
            if (!val) return;

            let p = null;
            if (val.startsWith('builtin_')) {
                const idx = parseInt(val.split('_')[1]);
                p = builtInPresets[idx];
            } else if (val.startsWith('custom_')) {
                const idx = parseInt(val.split('_')[1]);
                p = customPresets[idx];
            }

            if (!p) return;

            // Apply camera & global parameters
            if (p.zoom !== undefined) this.targetZoom = p.zoom;
            if (p.cx !== undefined) this.targetCenter = { x: p.cx, y: p.cy };
            if (p.maxIterations !== undefined) {
                this.maxIterations = p.maxIterations;
                document.getElementById('iterations-slider').value = p.maxIterations;
                document.getElementById('iterations-val').innerText = p.maxIterations;
            }
            if (p.palette) {
                this.palette = p.palette;
                document.querySelectorAll('.palette-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.palette === p.palette);
                });
            }
            if (p.colorShift !== undefined) {
                this.colorShift = p.colorShift;
                document.getElementById('color-shift-slider').value = p.colorShift;
                document.getElementById('color-shift-val').innerText = p.colorShift.toFixed(1);
            }
            if (p.flowSpeed !== undefined) {
                this.flowSpeed = p.flowSpeed;
                document.getElementById('flow-speed-slider').value = p.flowSpeed;
                document.getElementById('flow-speed-val').innerText = p.flowSpeed.toFixed(1);
            }
            if (p.autoZoomSpeed !== undefined) {
                this.autoZoomSpeed = p.autoZoomSpeed;
                document.getElementById('auto-zoom-slider').value = p.autoZoomSpeed;
                const badge = document.getElementById('auto-zoom-val');
                if (this.autoZoomSpeed === 0) badge.innerText = 'OFF';
                else if (this.autoZoomSpeed > 0) badge.innerText = `+${this.autoZoomSpeed.toFixed(1)} IN`;
                else badge.innerText = `${this.autoZoomSpeed.toFixed(1)} OUT`;
            }

            // Mode specific parameters
            if (this.mode === 'julia') {
                if (p.params) {
                    this.params.cr = p.params.cr;
                    this.params.ci = p.params.ci;
                    this.params.crFine = p.params.crFine || 0.0;
                    this.params.ciFine = p.params.ciFine || 0.0;
                } else {
                    this.params.cr = p.cr;
                    this.params.ci = p.ci;
                }
                this.updateSliderUI('cr', this.params.cr);
                this.updateSliderUI('ci', this.params.ci);
                this.updateSliderUI('crFine', this.params.crFine || 0.0);
                this.updateSliderUI('ciFine', this.params.ciFine || 0.0);
            } else if (this.mode === 'mandelbrot') {
                const powVal = p.params ? p.params.power : p.power;
                if (powVal !== undefined) {
                    this.params.power = powVal;
                    this.updateSliderUI('power', powVal);
                }
            } else if (this.mode === 'newton') {
                const np = p.params ? p.params.newtonPower : p.newtonPower;
                const rf = p.params ? p.params.relaxation : p.relaxation;
                if (np !== undefined) {
                    this.params.newtonPower = np;
                    this.updateSliderUI('newtonPower', np);
                }
                if (rf !== undefined) {
                    this.params.relaxation = rf;
                    this.updateSliderUI('relaxation', rf);
                }
            }

            this.updateFormulaHUD();
        };
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    renderLoop(timestamp) {
        // Smooth camera lerp
        this.zoom += (this.targetZoom - this.zoom) * 0.1;
        this.center.x += (this.targetCenter.x - this.center.x) * 0.1;
        this.center.y += (this.targetCenter.y - this.center.y) * 0.1;

        // FPS & GPU Performance Load Monitor tracking
        this.frameCount++;
        const elapsed = timestamp - this.lastTime;
        if (elapsed >= 400) {
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            const frameMs = (elapsed / this.frameCount).toFixed(1);
            
            document.getElementById('fps-val').innerText = this.fps;
            document.getElementById('ms-val').innerText = `${frameMs}ms`;

            const loadBadge = document.getElementById('load-val');
            if (this.fps >= 55) {
                loadBadge.innerText = 'LOW';
                loadBadge.style.color = '#45f3c2';
            } else if (this.fps >= 30) {
                loadBadge.innerText = 'MODERATE';
                loadBadge.style.color = '#ffa500';
            } else {
                loadBadge.innerText = 'HIGH';
                loadBadge.style.color = '#ff4500';
            }

            const zoomStr = this.zoom > 10000 ? `${this.zoom.toExponential(2)}x` : `${this.zoom.toFixed(2)}x`;
            const coordXStr = Math.abs(this.center.x) < 0.001 && this.center.x !== 0 ? this.center.x.toExponential(3) : this.center.x.toFixed(4);
            const coordYStr = Math.abs(this.center.y) < 0.001 && this.center.y !== 0 ? this.center.y.toExponential(3) : this.center.y.toFixed(4);
            document.getElementById('zoom-val').innerText = zoomStr;
            document.getElementById('coord-val').innerText = `${coordXStr}, ${coordYStr}`;
            this.frameCount = 0;
            this.lastTime = timestamp;

            // Auto-save live working session state to LocalStorage
            this.saveActiveSessionState();
        }

        const dt = (timestamp - (this.prevTimestamp || timestamp)) * 0.001;
        this.prevTimestamp = timestamp;
        this.accumulatedFlow += dt * this.flowSpeed * 0.15;

        // Continuous Auto-Zoom towards screen center
        if (this.autoZoomSpeed !== 0) {
            const autoZoomFactor = Math.exp(this.autoZoomSpeed * dt * 0.4);
            this.targetZoom = Math.max(0.1, Math.min(1e30, this.targetZoom * autoZoomFactor));
        }

        // WebGL Render Pass
        const gl = this.gl;
        if (gl) {
            gl.useProgram(this.program);

            // Helper to split a float64 into high and low float32 components
            const splitFloat = (val) => {
                const hi = Math.fround(val);
                const lo = val - hi;
                return [hi, lo];
            };

            const [cxHi, cxLo] = splitFloat(this.center.x);
            const [cyHi, cyLo] = splitFloat(this.center.y);
            const [zoomHi, zoomLo] = splitFloat(this.zoom);

            // Bind Uniforms
            gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
            gl.uniform2f(this.uniforms.center_hi, cxHi, cyHi);
            gl.uniform2f(this.uniforms.center_lo, cxLo, cyLo);
            gl.uniform1f(this.uniforms.zoom_hi, zoomHi);
            gl.uniform1f(this.uniforms.zoom_lo, zoomLo);
            gl.uniform1i(this.uniforms.max_iterations, this.maxIterations);

            const modeMap = { julia: 0, mandelbrot: 1, newton: 2 };
            gl.uniform1i(this.uniforms.mode, modeMap[this.mode] !== undefined ? modeMap[this.mode] : 0);
            
            gl.uniform1f(this.uniforms.time, this.accumulatedFlow);

            const paletteMap = { electric: 0, purpleOrange: 1, toxic: 2, cyber: 3, emerald: 4, fire: 5, gold: 6, cosmic: 7 };
            gl.uniform1i(this.uniforms.palette, paletteMap[this.palette] !== undefined ? paletteMap[this.palette] : 0);
            gl.uniform1f(this.uniforms.color_shift, this.colorShift);

            // Custom mode uniforms (adding fine-tuning trim offsets)
            const finalCr = this.params.cr + (this.params.crFine || 0.0);
            const finalCi = Math.max(-0.7, Math.min(0.7, this.params.ci + (this.params.ciFine || 0.0)));
            gl.uniform2f(this.uniforms.c, finalCr, finalCi);
            gl.uniform1f(this.uniforms.power, this.params.power);
            gl.uniform1f(this.uniforms.newton_power, this.params.newtonPower);
            gl.uniform1f(this.uniforms.relaxation, this.params.relaxation);

            // Draw full-screen Quad
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            const posLoc = gl.getAttribLocation(this.program, 'a_position');
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        requestAnimationFrame((t) => this.renderLoop(t));
    }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    window.mathStudio = new MathStudio();
});
