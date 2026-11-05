// Graphics constants
const NOTE_HEIGHT = 0;
const PIANO_WIDTH = piano.clientWidth*8/10;

const WHITE_NOTE_WIDTH = PIANO_WIDTH/52;
const BLACK_NOTE_WIDTH = WHITE_NOTE_WIDTH*5/10;

const WHITE_NOTE_HEIGHT = WHITE_NOTE_WIDTH*5;
const BLACK_NOTE_HEIGHT = BLACK_NOTE_WIDTH*7;

const PIANO_START_X = (piano.clientWidth-PIANO_WIDTH)/2;
const PIANO_START_Y = viewer.clientHeight;
const FALL_SPEED = 0.1  ;
const START_NOTE = 21; // C3
const END_NOTE = 108;   // C6
const NOTE_START_HEIGHT = 100;

// NOTE CLASS

// Piano constants (physical)
const PHY_MIN_OFF_ON_DELAY = 100; // ms
const PHY_MAX_CONCURENT_NOTES = 10;

// Variables
let midiData = null;
let notes = [];
let startTime = null;
let paused = true;
let pauseTime = 0;
let white_key_counter = 0;
let keys = null;

let time_delta = 1000; // MS delay before song start

const events = [];  // Create events (those are sent to the ESP, not the notes.)
const adjustedEvents = []; // Adjusted events are corrected to fit the piano limitaions
// Prepare all notes from midi file.
function prepareNotes() {
  viewer.innerHTML = "";
  notes = [];

  // Read tracks and add notes
  midiData.tracks.forEach(track => {
    track.notes.forEach(note => {
      const el = document.createElement("div");
      el.className = "note";
      
      el.style.width = note_width(note.midi);
      el.style.left = noteX(note.midi);
      el.style.height = `${note.duration}px`;
      el.style.willChange = "transform";
      el.style.visibility="hidden";
      viewer.appendChild(el);

      // Create a note based on the elements given by the midi file
      note = {
        time: Math.round(note.time*1000)+time_delta, // Change to ms
        duration: Math.round(note.duration*1000), // ms
        velocity: Math.round(note.velocity*255),
        midi: note.midi
      }
      notes.push({note, el });
    });
  });
  // Sort notes in time
  notes.sort((a, b) => a.note.time - b.note.time);

  configure_events();
}

/*
* Analyse notes, add ON OFF argument, check for validity. Moves all notes forward from
* time delta.
* adapt notes format.
* adjust for physical limitations.
*/
function configure_events(){
  // Move all notes forward from time delta

  // Create events (On and Off)
  for (let note of notes) {
    const start = note.note.time;
    const end = note.note.time + note.note.duration;

    events.push({
      midi: note.note.midi,
      time: start,
      on: 1,
      velocity:note.note.velocity,
      noteRef: note
    });

    events.push({
      midi: note.note.midi,
      time: end,
      on: 0,
      velocity:0,
      noteRef: note
    });
  }

  // Now check for notes restarts (add mandatory waiting time. (reduce note duration, and add a note off))
  // Loops through each keys

  // Sort events by time
  events.sort((a, b) =>
    a.time !== b.time ? a.time - b.time : a.on - b.on
  );
  const delayed_events = [];
  const activeByMidi = new Map();
  // Add mandatory delay between on notes.
  for (const e of events) {
    const midi = e.midi;

    if (e.on === 1) {
      // NOTE ON
      if (activeByMidi.has(midi)) {
        const prev = activeByMidi.get(midi);

        const forcedOffTime =
          Math.max(
            prev.time,               // never before previous ON
            e.time - PHY_MIN_OFF_ON_DELAY
          );

        // Insert forced OFF
        delayed_events.push({
          midi,
          time: forcedOffTime,
          on: 0,
          noteRef: prev.noteRef
        });

        activeByMidi.delete(midi);
      }

      // Insert current ON
      delayed_events.push(e);
      activeByMidi.set(midi, e);

    } else {
      // NOTE OFF
      if (activeByMidi.get(midi) === e.noteRef) {
        activeByMidi.delete(midi);
      }
      delayed_events.push(e);
    }
  }

  delayed_events.sort((a, b) =>
    a.time !== b.time ? a.time - b.time : a.on - b.on
  );
  // Now remove consecutives offs on the same note
  const lastEventByMidi = new Map();

  for (const e of delayed_events) {
    const last = lastEventByMidi.get(e.midi);

    if (e.on === 0 && last?.on === 0) {
      // consecutive OFF for same midi → drop this one
      continue;
    }

    adjustedEvents.push(e);
    lastEventByMidi.set(e.midi, e);
  }

  // Update notes height
  for (let note of notes) {
    note.el.style.height =
      `${note.note.duration * FALL_SPEED}px`;
  }
 //console.log(events);
}


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

function generate_piano(){
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

// Track which MIDI notes are currently sounding
const activeNotes = new Set();
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
    if (y_bot < 0 || y_bot-current_height > viewerHeight || obj.note.on == "0"){
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
