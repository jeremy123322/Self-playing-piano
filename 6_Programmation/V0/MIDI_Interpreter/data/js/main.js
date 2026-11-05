/*
*
*/
//const gateway = `ws://localhost:8080`;
const gateway = `ws://${window.location.hostname}/ws`;
let websocket;
window.addEventListener("load", onLoad);

// Web socket 
function onLoad() {
  initWebSocket();
}

// Piano graphical interface
let audio = true;
const viewer = document.getElementById("viewer");
const piano = document.getElementById("piano");
const playPauseBtn = document.getElementById("playPause");
const fileInput = document.getElementById("fileInput");
const restartBtn = document.getElementById("restart");
const LOOKAHEAD_MS = 500;       // Look ahead

let nextEventIndex = 0;  // cursor into notes[]

// HTML FORMS
restartBtn.onclick = () => {
  // Always reset time
  pauseTime = 0;
  startTime = performance.now();
  // Reset note event index
  nextEventIndex = 0;
  // Reset visuals
  display_notes(time_delta);
  document.getElementById("timeDisplay").textContent = formatTime(0);

  // send restart command
  websocket.send(JSON.stringify({type: "restart"}));
  if (!paused) {
    // Was playing → keep playing
    requestAnimationFrame(animate);
  } else {
    // Was paused → stay paused
    playPauseBtn.textContent = "Play";
  }
};

// On file input
fileInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  midiData = new Midi(arrayBuffer);
  prepareNotes();
  // Track-level info
  const trackInfo = {
      ticksPerBeat: midiData.header.ppq, // pulses per quarter note
      tempo: midiData.header.tempos[0].bpm || 120, // first tempo in BPM
      trackCount: midiData.tracks.length
  };
  // Send track infos 
  websocket.send(JSON.stringify({ type: "track_info", data: trackInfo }));
  // Show notes
  display_notes(0);
});

playPauseBtn.onclick = () => {
  paused = !paused;
  playPauseBtn.textContent = paused ? "Play" : "Pause";

  if (!paused) {
    
    // Compute time (minus pause time)
    startTime = performance.now() - pauseTime;
    const time_info = {
      time: pauseTime
    };
    // Send current midi time to server. (Synchronize with arduino)
    websocket.send(JSON.stringify({type: "resume",data:time_info}));
    requestAnimationFrame(animate);
  } else {
    // pause
    websocket.send(JSON.stringify({type: "pause"}));
    pauseTime = performance.now() - startTime;
  }
};

// Piano
generate_piano();

// Animate the down coming of the notes
function animate(time) {
  // Kill the sound in case of pause
  if (paused){
    //synth.releaseAll();
    return;
  }
  // Compute elapsed time [s]
  const elapsed = (time - startTime);

  // Update elapsed time on screen
  document.getElementById("timeDisplay").textContent= formatTime(elapsed/1000);
  // Html objects
  keys_currently_played = [];

  // Get currently played notes
  const notes_currently_played = new Set();
  for (let i = 0; i < notes.length; i++) {
    const obj = notes[i];
    const midi = obj.note.midi;
    const noteStart = obj.note.time;
    const noteEnd = obj.note.time + obj.note.duration;

    // Check for notes that need to be played currently
    if (elapsed >= noteStart && elapsed < noteEnd) {
        // Save tone and current note id
        notes_currently_played.add(i);
        keys_currently_played.push(get_key(midi));
    }
  }
  // Graphical interface
  display_notes(elapsed);

  // Highlight currently played keys
  highlight_notes(keys_currently_played);
  
  // Send events to the ESP-32.
  send_events(elapsed);

  // Repeat the animation
  requestAnimationFrame(animate);
}

/*
* By the elapsed time, 
*/
function send_events(elapsed) {
  // Compute the last time to look up 
  const windowEnd = elapsed + LOOKAHEAD_MS;

  while (
    nextEventIndex < adjustedEvents.length &&
    adjustedEvents[nextEventIndex].time <= windowEnd
  ) {
    send_event_to_esp(adjustedEvents[nextEventIndex]);
    nextEventIndex++;
  }
}


function send_event_to_esp(event) {
  // Constitute the message.
  const msg = {
    time: event.time,
    midi: event.midi - START_NOTE,
    velocity: event.velocity,
    on: event.on
  };

  websocket.send(JSON.stringify({
    type: "event",
    data: msg
  }));
}
