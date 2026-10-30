/**
 * Imposter word lists (SERVER ONLY: imported by rules.ts only, never by ui.tsx).
 * Original lists. Each word is a single word, and no word is a substring of another word, of a
 * category label or of the view's field names, so leak checks on views can't give false positives.
 */
import type { CategoryId } from "./types";

export const WORDS: Record<CategoryId, readonly string[]> = {
  animals: [
    "Giraffe", "Penguin", "Octopus", "Kangaroo", "Elephant", "Hedgehog", "Dolphin", "Zebra",
    "Camel", "Parrot", "Squirrel", "Tortoise", "Flamingo", "Gorilla", "Panda", "Jellyfish",
    "Raccoon", "Crocodile", "Walrus", "Lobster", "Peacock", "Koala", "Rhino", "Moose",
  ],
  food: [
    "Pizza", "Sushi", "Pancake", "Burrito", "Popcorn", "Lasagna", "Pretzel", "Mango",
    "Croissant", "Dumpling", "Omelette", "Pineapple", "Waffle", "Noodles", "Avocado", "Cupcake",
    "Lemonade", "Biryani", "Samosa", "Broccoli", "Watermelon", "Nachos", "Porridge", "Chutney",
  ],
  places: [
    "Airport", "Library", "Hospital", "Museum", "Castle", "Desert", "Casino", "Stadium",
    "Bakery", "Aquarium", "Lighthouse", "Prison", "Jungle", "Volcano", "Cinema", "Temple",
    "Supermarket", "Submarine", "Igloo", "Barn", "Zoo", "Harbor", "Pyramid", "Theater",
  ],
  jobs: [
    "Firefighter", "Dentist", "Astronaut", "Plumber", "Chef", "Pilot", "Lawyer", "Magician",
    "Farmer", "Nurse", "Detective", "Carpenter", "Barber", "Lifeguard", "Journalist", "Architect",
    "Electrician", "Librarian", "Mechanic", "Photographer", "Waiter", "Tailor", "Surgeon", "Clown",
  ],
  sports: [
    "Cricket", "Tennis", "Chess", "Bowling", "Surfing", "Archery", "Badminton", "Hockey",
    "Golf", "Boxing", "Karate", "Rugby", "Skiing", "Fencing", "Volleyball", "Marathon",
    "Kabaddi", "Wrestling", "Dominoes", "Darts", "Snooker", "Rowing", "Juggling", "Hopscotch",
  ],
  home: [
    "Toaster", "Pillow", "Mirror", "Fridge", "Bathtub", "Candle", "Blender", "Curtain",
    "Doormat", "Ladder", "Kettle", "Toothbrush", "Umbrella", "Vacuum", "Bookshelf", "Lamp",
    "Sofa", "Scissors", "Microwave", "Hammock", "Teapot", "Wardrobe", "Doorbell", "Calendar",
  ],
  transport: [
    "Bicycle", "Helicopter", "Tractor", "Skateboard", "Ambulance", "Canoe", "Rocket", "Scooter",
    "Tram", "Sailboat", "Taxi", "Escalator", "Gondola", "Motorbike", "Train", "Hovercraft",
    "Rickshaw", "Elevator", "Zeppelin", "Ferry", "Limousine", "Unicycle", "Bulldozer", "Sled",
  ],
  nature: [
    "Rainbow", "Tornado", "Glacier", "Waterfall", "Cactus", "Mushroom", "Thunder", "Iceberg",
    "Snowflake", "Earthquake", "Coral", "Meadow", "Sunflower", "Swamp", "Comet", "Fog",
    "Lightning", "Pebble", "Bamboo", "Canyon", "Eclipse", "Puddle", "Seaweed", "Acorn",
  ],
  clothing: [
    "Sneakers", "Tuxedo", "Pajamas", "Scarf", "Sombrero", "Mittens", "Raincoat", "Bikini",
    "Kimono", "Sandals", "Necktie", "Apron", "Turban", "Backpack", "Sunglasses", "Wig",
    "Hoodie", "Overalls", "Saree", "Crown", "Earrings", "Wristwatch", "Swimsuit", "Helmet",
  ],
  hobbies: [
    "Knitting", "Gardening", "Karaoke", "Origami", "Pottery", "Camping", "Fishing", "Baking",
    "Painting", "Yoga", "Puzzles", "Sudoku", "Birdwatching", "Sculpting", "Dancing", "Podcasts",
    "Gaming", "Hiking", "Ballet", "Graffiti", "Kites", "Stargazing", "Scrapbooking", "Calligraphy",
  ],
};
