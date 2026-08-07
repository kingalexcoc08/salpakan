import { useState } from "react";
import { CreateMatchScreen } from "./components/CreateMatchScreen.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { JoinMatchScreen } from "./components/JoinMatchScreen.js";
import { MatchContainer } from "./components/MatchContainer.js";
import { clearMatch, loadMatch, saveMatch, type MatchCredentials } from "./storage.js";

type HomeSubScreen = "HOME" | "CREATE" | "JOIN";

export default function App() {
  const [match, setMatch] = useState<MatchCredentials | null>(() => loadMatch());
  const [subScreen, setSubScreen] = useState<HomeSubScreen>("HOME");

  function startMatch(m: MatchCredentials) {
    saveMatch(m);
    setMatch(m);
  }

  function exitMatch() {
    clearMatch();
    setMatch(null);
    setSubScreen("HOME");
  }

  return (
    <>
      <header className="app-header">
        <h1>
          <span className="flag">⚑</span> Salpakan Arbiter
        </h1>
      </header>

      {match ? (
        <MatchContainer match={match} onExit={exitMatch} />
      ) : subScreen === "CREATE" ? (
        <CreateMatchScreen onCreated={startMatch} onBack={() => setSubScreen("HOME")} />
      ) : subScreen === "JOIN" ? (
        <JoinMatchScreen onJoined={startMatch} onBack={() => setSubScreen("HOME")} />
      ) : (
        <HomeScreen onCreate={() => setSubScreen("CREATE")} onJoin={() => setSubScreen("JOIN")} />
      )}
    </>
  );
}
