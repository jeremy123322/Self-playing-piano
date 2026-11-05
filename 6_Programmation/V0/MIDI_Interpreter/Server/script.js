const gateway = `ws://localhost:8080`;
//const gateway = `ws://${window.location.hostname}/ws`;
let websocket;

window.addEventListener("load", onLoad);

// Web socket 
function onLoad() {
  initWebSocket();
}

function initWebSocket() {
  websocket = new WebSocket(gateway);

  websocket.onopen = () => {
    console.log("WebSocket connected");
  };

  websocket.onclose = () => {
    console.log("WebSocket disconnected, retrying...");
    //setTimeout(initWebSocket, 2000); // Retry connection
  };

  websocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.id === "battery") {
        console.log(message);
      }
    } catch (error) {
      console.log("Received non-JSON message:", event.data);
    }
  };
}

// Piano graphical interface
let audio = true;
const viewer = document.getElementById("viewer");
const piano = document.getElementById("piano");
const playPauseBtn = document.getElementById("playPause");
const fileInput = document.getElementById("fileInput");
const restartBtn = document.getElementById("restart");

const NOTE_HEIGHT = 0;
const PIANO_WIDTH = piano.clientWidth*8/10;

const WHITE_NOTE_WIDTH = PIANO_WIDTH/52;
const BLACK_NOTE_WIDTH = WHITE_NOTE_WIDTH*5/10;

const WHITE_NOTE_HEIGHT = WHITE_NOTE_WIDTH*5;
const BLACK_NOTE_HEIGHT = BLACK_NOTE_WIDTH*7;

const PIANO_START_X = (piano.clientWidth-PIANO_WIDTH)/2;
const PIANO_START_Y = viewer.clientHeight;
const FALL_SPEED = 100  ;
const START_NOTE = 21; // C3
const END_NOTE = 108;   // C6
const NOTE_START_HEIGHT = 100;

let midiData = null;
let notes = [];
let startTime = null;
let paused = true;
let pauseTime = 0;
let white_key_counter = 0;
let keys = null;
/* Build piano */

/*
* Returns if a given midi note is black or white
*/
function isBlack(midi_note){
  const black_keys = [1,3,6,8,10];
  const note_id = midi_note-START_NOTE;
  // Start of the piano
  if (note_id < 3){
    if (note_id == 1){
      return true;
    }else{
      return false;
    }
  }else{
    const note = (note_id-3) % 12;
    const isBlack = black_keys.includes(note);
    if (isBlack){
      return true;
    }else{
      return false;
    } 
  }
}

// Generate piano display (create notes)
for (let n = START_NOTE; n <= END_NOTE; n++) {
  // Compute key position
  const note_id = n - START_NOTE;
  const position_x = note_id*WHITE_NOTE_WIDTH;
  const key = document.createElement("div");
  // Start of the piano
  if (isBlack(n)){
    key.className = "key black";
  }else{
    key.className = "key white";
  }
  // Set position and dimensions
  if (key.className == "key white"){
    key.style.left = `${white_key_counter*WHITE_NOTE_WIDTH+PIANO_START_X}px`;
    key.style.width = `${WHITE_NOTE_WIDTH}px`;
    key.style.height = `${WHITE_NOTE_HEIGHT}px`;
    white_key_counter++;
  }else{
    const x_pos = (white_key_counter)*WHITE_NOTE_WIDTH-BLACK_NOTE_WIDTH/2+PIANO_START_X;

    key.style.left = `${x_pos}px`;
    key.style.width = `${BLACK_NOTE_WIDTH}px`;
    key.style.height = `${BLACK_NOTE_HEIGHT}px`;
  }
  piano.appendChild(key);
}
// Save piano keys
keys = piano.getElementsByClassName("key");

// Return key object from midi note
function get_key(midi){
  // Return the key based on the midi number
  return keys[midi-START_NOTE];
}

// Get note x coordinates from midi note
function noteX(midi) {
  // Return the note x position
  const note_id = midi-START_NOTE;
  return keys[note_id].style.left;
}

function note_width(midi){
  // Return corresponding width for a given note
  if (isBlack(midi)){
    return ""+BLACK_NOTE_WIDTH+"px";
  }
  return ""+WHITE_NOTE_WIDTH+"px";
}

// HTML FORMS
restartBtn.onclick = () => {
  // Always reset time
  pauseTime = 0;
  startTime = performance.now();

  // Reset visuals
  display_notes(0);
  document.getElementById("timeDisplay").textContent = formatTime(0);

  if (!paused) {
    // Was playing → keep playing
    requestAnimationFrame(animate);
  } else {
    // Was paused → stay paused
    playPauseBtn.textContent = "Play";
  }
};

fileInput.addEventListener("change", async e => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  midiData = new Midi(arrayBuffer);
  prepareNotes();
  // Show notes
  display_notes(0);
});


playPauseBtn.onclick = () => {
  paused = !paused;
  playPauseBtn.textContent = paused ? "Play" : "Pause";

  if (!paused) {
    // resume or start
    startTime = performance.now() - pauseTime;
    requestAnimationFrame(animate);
  } else {
    // pause
    pauseTime = performance.now() - startTime;
  }
};

// Prepare all notes from midi file.
function prepareNotes() {
  viewer.innerHTML = "";
  notes = [];

  midiData.tracks.forEach(track => {
    track.notes.forEach(note => {
      const el = document.createElement("div");
      el.className = "note";
      
      el.style.width = note_width(note.midi);
      el.style.left = noteX(note.midi);
      el.style.height = `${note.duration * FALL_SPEED}px`;
      el.style.willChange = "transform";
      el.style.visibility="hidden";
      viewer.appendChild(el);
      notes.push({ note, el });
    });
  });
}

// Audio player
const synth = new Tone.PolySynth(Tone.Synth, {
  maxPolyphony: 30,

}).toDestination();

// Track which MIDI notes are currently sounding
const activeNotes = new Set();

// Make sure audio is unlocked once
let audioStarted = false;

async function ensureAudioStarted() {
  if (!audioStarted) {
    await Tone.start();
    audioStarted = true;
  }
}

// MIDI player
let viewerHeight = 0;
function updateViewerSize() {
  viewerHeight = viewer.clientHeight;
}

window.addEventListener("resize", updateViewerSize);
updateViewerSize();


function display_notes(elapsed){
  // Display notes on the screen
  for (let i = 0; i < notes.length; i++) {
    const obj = notes[i];

    // Y coordinates of the bottom of the key
    const y_bot =
      viewerHeight -
      (obj.note.time - elapsed) * FALL_SPEED -
      NOTE_HEIGHT;
    const current_height = obj.note.duration*FALL_SPEED;
    // Cut off-screen notes
    if (y_bot < 0 || y_bot-current_height > viewerHeight){
      obj.el.style.visibility="hidden";
      continue;
    }
    // Notes currently on screen
    obj.el.style.visibility="visible";
    obj.el.style.transform = `translate3d(0, ${y_bot-current_height}px, 0)`;
  }
}

function highlight_notes(keys_currently_played){
  for (let key of keys){
    if (keys_currently_played.includes(key)){
      key.style.background="#00FF00";
    }else{
      if (key.className == "key white"){
        key.style.background="#FFFFFF";
      }else{
        key.style.background="#000000";
      }
    }
  }
}

// Format a time in [mm:ss:cs]
function formatTime(seconds) {
  const m  = Math.floor(seconds / 60);
  const s  = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100); // centiseconds

  return (
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0") + ":" +
    String(cs).padStart(2, "0")
  );
}

// Animate the down coming of the notes
function animate(time) {
  // Kill the sound in case of pause
  if (paused){
    synth.releaseAll();
    return;
  }
  // Compute elapsed time [s]
  const elapsed = (time - startTime) * 0.001;

  // Update elapsed time on screen
  document.getElementById("timeDisplay").textContent= formatTime(elapsed);
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
  // ONLY FOR AUDIO
  // Turn on notes that are in keys_currently_played but not active
  for (let id of notes_currently_played) {
    if (!activeNotes.has(id)) {
      const midi = notes[id].note.midi;
      const noteName = Tone.Frequency(midi, "midi").toNote();

      synth.triggerAttack(noteName);
      activeNotes.add(id);
    }
  }

  // Turn off notes that are active but no longer in keys_currently_played
  for (let id of activeNotes) {
    if (!notes_currently_played.has(id)) {
      const midi = notes[id].note.midi;
      const noteName = Tone.Frequency(midi, "midi").toNote();        
      synth.triggerRelease(noteName);
      activeNotes.delete(id);
    }
  }
  /*for (let id of activeNotes) {
    if (!notes_currently_played.has(id)) {
      const midi = notes[id].note.midi;
      const noteName = Tone.Frequency(midi, "midi").toNote();        
      synth.triggerRelease(noteName);
      activeNotes.delete(id);
    }
  }*/
  for (let id of activeNotes) {
    if (!notes_currently_played.has(id)) {
      const midi = notes[id].note.midi;
      const noteName = Tone.Frequency(midi, "midi").toNote();        
      synth.triggerRelease(noteName);
      activeNotes.delete(id);
    }
  }
  console.log(activeNotes);
  requestAnimationFrame(animate);
}

    