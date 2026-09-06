const fs = require('fs').promises; 
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'bookings.json');

async function read(){
  try{
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  }catch(e){
    await fs.writeFile(DATA_FILE, '[]', 'utf8');
    return [];
  }
}

async function write(records){
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = { read, write };
