import { Menu, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUi } from "../context/UiContext";

export function AppHeader() {
  const navigate = useNavigate();
  const { activePerson, people, changePerson, addPerson } = useUi();

  function addOperator() {
    const name = window.prompt("Nombre de la persona que atiende:");
    if (name?.trim()) addPerson(name);
  }

  return (
    <header className="mobile-header-bigsur">
      <div className="mobile-header-content">
        <div className="mobile-brand-orb">
          <Sparkles size={20} />
        </div>
        <div className="mobile-brand-copy">
          <strong>MYPE Voz</strong>
          <small>Tu negocio organizado con IA</small>
        </div>

        <div className="mobile-header-actions">
          <select
            aria-label="Persona activa"
            value={activePerson}
            onChange={(event) => changePerson(event.target.value)}
            className="operator-selector-bigsur"
          >
            {people.map((person) => (
              <option key={person}>{person}</option>
            ))}
          </select>

          <button
            onClick={addOperator}
            className="header-icon-button"
            title="Agregar persona"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => navigate("/mas")}
            className="header-icon-button"
            title="Más módulos"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
