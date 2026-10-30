/**
 * Brain Tilt word decks (original, family-friendly). SERVER ONLY: imported by rules.ts, never by ui.tsx.
 * Every deck has 40 words; words are unique across decks and no word is a substring of another
 * (case-insensitive), so leak checks on views stay exact.
 */
import type { DeckId } from "./types";

export const DECK_WORDS: Record<DeckId, readonly string[]> = {
  animals: [
    "Elephant", "Giraffe", "Penguin", "Kangaroo", "Octopus", "Dolphin", "Crocodile", "Flamingo",
    "Hedgehog", "Squirrel", "Peacock", "Zebra", "Gorilla", "Koala", "Sloth", "Panda",
    "Camel", "Jellyfish", "Shark", "Butterfly", "Spider", "Snail", "Frog", "Parrot",
    "Rabbit", "Tortoise", "Lion", "Tiger", "Polar Bear", "Raccoon", "Goldfish", "Chicken",
    "Hippo", "Moose", "Turkey", "Goat", "Seahorse", "Woodpecker", "Ostrich", "Lobster",
  ],
  food: [
    "Pizza", "Spaghetti", "Pancakes", "Popcorn", "Ice Cream", "Watermelon", "Banana", "Sandwich",
    "Taco", "Sushi", "Cupcake", "Donut", "French Fries", "Hot Dog", "Cheese", "Pineapple",
    "Carrot", "Broccoli", "Lemonade", "Hot Chocolate", "Birthday Cake", "Cookie", "Honey", "Toast",
    "Scrambled Eggs", "Burrito", "Noodle Soup", "Strawberry", "Coconut", "Pretzel", "Corn on the Cob", "Milkshake",
    "Peanut Butter", "Pickle", "Waffle", "Muffin", "Grapes", "Salad", "Chocolate Bar", "Samosa",
  ],
  home: [
    "Toothbrush", "Pillow", "Refrigerator", "Washing Machine", "Vacuum Cleaner", "Umbrella", "Alarm Clock", "Bathtub",
    "Staircase", "Doorbell", "Television", "Remote Control", "Frying Pan", "Teapot", "Lantern", "Mirror",
    "Blanket", "Sofa", "Bookshelf", "Lamp", "Microwave", "Broom", "Laundry Basket", "Hair Dryer",
    "Light Bulb", "Scissors", "Curtains", "Rubber Duck", "Keys", "Sock", "Slippers", "Ceiling Fan",
    "Mailbox", "Garden Hose", "Trash Can", "Calendar", "Piggy Bank", "Jigsaw Puzzle", "Bunk Bed", "Pressure Cooker",
  ],
  characters: [
    "Astronaut", "Firefighter", "Pirate", "Wizard", "Chef", "Doctor", "Teacher", "Pilot",
    "Detective", "Magician", "Dentist", "Farmer", "Lifeguard", "Clown", "Mermaid", "Robot",
    "Superhero", "Ninja", "Knight", "Princess", "Dragon", "Ghost", "Cowboy", "Mail Carrier",
    "Plumber", "Scientist", "Librarian", "Referee", "Photographer", "Bus Driver", "Juggler", "Ballerina",
    "Barber", "Beekeeper", "Mechanic", "Lumberjack", "Explorer", "Painter", "Judge", "Nurse",
  ],
  sports: [
    "Soccer", "Basketball", "Tennis", "Swimming", "Skateboarding", "Surfing", "Bowling", "Golf",
    "Karate", "Gymnastics", "Ice Skating", "Skiing", "Fishing", "Cycling", "Chess", "Volleyball",
    "Baseball", "Cricket", "Badminton", "Ping Pong", "Archery", "Boxing", "Rock Climbing", "Yoga",
    "Hula Hoop", "Jump Rope", "Kite Flying", "Knitting", "Gardening", "Camping", "Hide and Seek", "Tug of War",
    "Trampoline", "Marathon", "Horse Riding", "Scuba Diving", "Snowboarding", "Roller Skating", "Darts", "Kabaddi",
  ],
  places: [
    "Beach", "Library", "Airport", "Hospital", "Zoo", "Museum", "Castle", "Desert",
    "Jungle", "Volcano", "Supermarket", "Playground", "Train Station", "Movie Theater", "Bakery", "Island",
    "Igloo", "Lighthouse", "Treehouse", "Amusement Park", "Water Park", "Cave", "Waterfall", "Space Station",
    "Haunted House", "Classroom", "Restaurant", "Post Office", "Bus Stop", "Skyscraper", "Pyramid", "Bridge",
    "Circus", "Aquarium", "Garage", "Mountain Top", "Hotel", "Fire Station", "Car Wash", "Barn",
  ],
  actions: [
    "Brushing Teeth", "Tying Shoelaces", "Sneezing", "Yawning", "Dancing", "Whistling", "Snoring", "Clapping",
    "Hiccups", "Riding a Bike", "Climbing a Ladder", "Taking a Selfie", "Baking a Pie", "Walking a Dog", "Blowing Bubbles", "Making a Snowman",
    "Rowing a Boat", "Painting a Wall", "Digging a Hole", "Washing Dishes", "Mopping the Floor", "Reading a Map", "Opening a Present", "Playing the Drums",
    "Playing Guitar", "Combing Hair", "Ironing a Shirt", "Milking a Cow", "Riding a Rollercoaster", "Popping a Balloon", "Stubbing a Toe", "Chopping Onions",
    "Catching a Ball", "Waving Goodbye", "Shaking Hands", "Doing Push-Ups", "Lifting Weights", "Taking a Nap", "Hailing a Taxi", "Blowing Out Candles",
  ],
  nature: [
    "Rainbow", "Thunderstorm", "Tornado", "Snowflake", "Full Moon", "Sunrise", "Planet", "Comet",
    "Rocket", "Black Hole", "Earthquake", "Iceberg", "Forest", "Swamp", "Ocean", "Lightning",
    "Cloud", "Fog", "Sunset", "Shooting Star", "Galaxy", "Meteor", "Alien", "Sunflower",
    "Mushroom", "Cactus", "Seashell", "Puddle", "Tumbleweed", "Avalanche", "Coral Reef", "Northern Lights",
    "Eclipse", "Telescope", "Satellite", "Pine Cone", "Acorn", "Glacier", "Hurricane", "Sand Dune",
  ],
};
