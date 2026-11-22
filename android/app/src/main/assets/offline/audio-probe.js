// Exercise stereo mixing, transferable PCM blocks and real-time consumption in the APK WebView.
if (typeof registerProcessor === "function") {
  registerProcessor("audio-preflight", class extends AudioWorkletProcessor {
    constructor({processorOptions}) {
      super();
      this.capacity = processorOptions.buffered ? 10 : 3;
      this.prime = processorOptions.buffered ? 5 : 2;
      this.blocks = [];
      this.offset = 0;
      this.frames = 0;
      this.missing = 0;
      this.running = false;
      this.port.onmessage = ({data: producer}) => {
        this.producer = producer;
        producer.onmessage = event => this.blocks.push(event.data);
        for (let i = 0; i < this.capacity; i++) producer.postMessage(0);
      };
    }
    process(_, outputs) {
      if (!this.running) {
        if (this.blocks.length < this.prime) return true;
        this.running = true;
      }
      const [left, right] = outputs[0];
      for (let i = 0; i < left.length; i++) {
        const block = this.blocks[0];
        if (!block) { this.missing++; continue; }
        left[i] = block[this.offset++] / 32768;
        right[i] = block[this.offset++] / 32768;
        if (this.offset === block.length) {
          this.blocks.shift();
          this.offset = 0;
          this.producer.postMessage(0);
        }
      }
      this.frames += left.length;
      if (this.frames < sampleRate * 1.5) return true;
      this.port.postMessage(this.missing / this.frames < 0.015);
      return false;
    }
  });
} else {
  self.onmessage = ({data: {port, rate}}) => {
    let frame = 0;
    port.onmessage = () => {
      const block = new Int16Array(2048);
      for (let i = 0; i < block.length; i += 2, frame++) {
        let sample = 0;
        for (let voice = 1; voice <= 12; voice++)
          sample += Math.sin(frame * (voice * 97 * 2 * Math.PI / rate));
        block[i] = block[i + 1] = sample * 2100;
      }
      port.postMessage(block, [block.buffer]);
    };
  };
}
