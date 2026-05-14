(function () {
    function createWaveform(elementId) {
        const root = document.getElementById(elementId);
        if (!root) {
            return {
                start: () => {},
                stop: () => {}
            };
        }

        const canvas = root.querySelector('canvas');
        const context = canvas.getContext('2d');
        let audioContext = null;
        let analyser = null;
        let source = null;
        let animationFrame = null;
        let frequencyData = null;

        function resizeCanvas() {
            const ratio = window.devicePixelRatio || 1;
            const width = Math.max(root.clientWidth, 260);
            const height = Math.max(root.clientHeight, 74);
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            return { width, height };
        }

        function drawIdle() {
            const { width, height } = resizeCanvas();
            context.clearRect(0, 0, width, height);
            context.strokeStyle = '#b8cfca';
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(10, height / 2);
            context.lineTo(width - 10, height / 2);
            context.stroke();
        }

        function drawLive() {
            const { width, height } = resizeCanvas();
            const centerY = height / 2;
            const barCount = Math.min(72, Math.max(34, Math.floor(width / 8)));
            const gap = 3;
            const barWidth = Math.max(2, (width - (barCount - 1) * gap) / barCount);
            const gradient = context.createLinearGradient(0, 0, width, 0);

            gradient.addColorStop(0, '#00796b');
            gradient.addColorStop(0.52, '#12a38f');
            gradient.addColorStop(1, '#004d40');

            analyser.getByteFrequencyData(frequencyData);
            context.clearRect(0, 0, width, height);
            context.fillStyle = gradient;

            for (let index = 0; index < barCount; index += 1) {
                const bucketStart = Math.floor((index / barCount) * frequencyData.length);
                const bucketEnd = Math.max(bucketStart + 1, Math.floor(((index + 1) / barCount) * frequencyData.length));
                let total = 0;

                for (let bucket = bucketStart; bucket < bucketEnd; bucket += 1) {
                    total += frequencyData[bucket];
                }

                const average = total / (bucketEnd - bucketStart);
                const centerShape = Math.sin((index / (barCount - 1)) * Math.PI);
                const heightRatio = 0.14 + (average / 255) * 0.86;
                const barHeight = Math.max(4, heightRatio * centerShape * (height - 10));
                const x = index * (barWidth + gap);
                const y = centerY - (barHeight / 2);

                context.fillRect(x, y, barWidth, barHeight);
            }

            animationFrame = requestAnimationFrame(drawLive);
        }

        async function start(stream) {
            stop();
            root.hidden = false;
            root.classList.add('is-recording');

            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            await audioContext.resume();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.72;
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
            source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            drawLive();
        }

        function stop() {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }

            if (source) {
                source.disconnect();
                source = null;
            }

            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }

            analyser = null;
            frequencyData = null;
            root.classList.remove('is-recording');
            root.hidden = true;
            drawIdle();
        }

        window.addEventListener('resize', () => {
            if (!root.hidden && analyser) {
                resizeCanvas();
            }
        });
        drawIdle();

        return { start, stop };
    }

    window.DebbyWaveform = { create: createWaveform };
}());
