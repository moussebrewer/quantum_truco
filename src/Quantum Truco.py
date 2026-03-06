from __future__ import annotations

from dataclasses import dataclass, field
import random
from typing import Dict, List, Optional, Tuple, Iterable, Set


# ============================================================
# Cartas clásicas
# ============================================================

SUITS = ("espada", "basto", "oro", "copa")
RANKS = (1, 2, 3, 4, 5, 6, 7, 10, 11, 12)


@dataclass(frozen=True)
class Card:
    suit: str
    rank: int

    def __str__(self) -> str:
        return f"{self.rank} de {self.suit}"


def truco_deck_40() -> List[Card]:
    return [Card(s, r) for s in SUITS for r in RANKS]


def envido_value_single(c: Card) -> int:
    return c.rank if c.rank <= 7 else 0


def envido_score(cards: List[Card]) -> int:
    by_suit: Dict[str, List[int]] = {s: [] for s in SUITS}
    for c in cards:
        by_suit[c.suit].append(envido_value_single(c))

    best = 0
    for vals in by_suit.values():
        if len(vals) >= 2:
            vals_sorted = sorted(vals, reverse=True)
            best = max(best, 20 + vals_sorted[0] + vals_sorted[1])

    if best == 0:
        best = max(envido_value_single(c) for c in cards)
    return best


def has_flor(cards: List[Card]) -> bool:
    counts = {s: 0 for s in SUITS}
    for c in cards:
        counts[c.suit] += 1
    return max(counts.values()) == 3


def flor_score(cards: List[Card]) -> int:
    # Regla clásica simple: 20 + suma de las 3 cartas del mismo palo
    for s in SUITS:
        same = [c for c in cards if c.suit == s]
        if len(same) == 3:
            return 20 + sum(envido_value_single(c) for c in same)
    return -1


def truco_power(c: Card) -> int:
    if c.rank == 1 and c.suit == "espada":
        return 14
    if c.rank == 1 and c.suit == "basto":
        return 13
    if c.rank == 7 and c.suit == "espada":
        return 12
    if c.rank == 7 and c.suit == "oro":
        return 11
    if c.rank == 3:
        return 10
    if c.rank == 2:
        return 9
    if c.rank == 1 and c.suit in ("oro", "copa"):
        return 8
    if c.rank == 12:
        return 7
    if c.rank == 11:
        return 6
    if c.rank == 10:
        return 5
    if c.rank == 7 and c.suit in ("basto", "copa"):
        return 4
    if c.rank == 6:
        return 3
    if c.rank == 5:
        return 2
    if c.rank == 4:
        return 1
    raise ValueError(f"Carta inesperada: {c}")


# ============================================================
# Modelo cuántico
# ============================================================

@dataclass
class QuantumCard:
    pair_id: int
    idx_in_pair: int
    options: Tuple[Card, Card]
    collapsed_to: Optional[Card] = None

    def label(self) -> str:
        a, b = self.options
        return f"({a} | {b}) [pair {self.pair_id}:{self.idx_in_pair}]"


class QuantumDeck:
    def __init__(self, rng: random.Random):
        self.rng = rng
        base = truco_deck_40()
        self.rng.shuffle(base)

        self.pairs: Dict[int, Tuple[Card, Card]] = {}
        self.pair_bit: Dict[int, Optional[int]] = {}

        halves: List[QuantumCard] = []
        pid = 0
        for i in range(0, len(base), 2):
            a, b = base[i], base[i + 1]
            self.pairs[pid] = (a, b)
            self.pair_bit[pid] = None
            halves.append(QuantumCard(pid, 0, (a, b)))
            halves.append(QuantumCard(pid, 1, (a, b)))
            pid += 1

        self.rng.shuffle(halves)
        self.cards = halves

    def deal(self, n: int) -> List[QuantumCard]:
        if len(self.cards) < n:
            raise RuntimeError("Se acabó el mazo")
        hand = self.cards[:n]
        self.cards = self.cards[n:]
        return hand

    def measure_pair(self, pair_id: int) -> int:
        s = self.pair_bit[pair_id]
        if s is None:
            s = self.rng.randint(0, 1)
            self.pair_bit[pair_id] = s
        return s

    def collapse(self, qc: QuantumCard) -> Card:
        if qc.collapsed_to is not None:
            return qc.collapsed_to
        a, b = self.pairs[qc.pair_id]
        s = self.measure_pair(qc.pair_id)
        if (qc.idx_in_pair == 0 and s == 0) or (qc.idx_in_pair == 1 and s == 1):
            qc.collapsed_to = a
        else:
            qc.collapsed_to = b
        return qc.collapsed_to

    def collapse_all(self, cards: Iterable[QuantumCard]) -> List[Card]:
        return [self.collapse(q) for q in cards]


# ============================================================
# Métricas cuánticas
# ============================================================

def collapse_hypothetical(qc: QuantumCard, s_bit: int) -> Card:
    a, b = qc.options
    if (qc.idx_in_pair == 0 and s_bit == 0) or (qc.idx_in_pair == 1 and s_bit == 1):
        return a
    return b


def enumerate_worlds(hand: List[QuantumCard]) -> List[List[Card]]:
    pair_ids = sorted({q.pair_id for q in hand})
    total = 1 << len(pair_ids)
    worlds: List[List[Card]] = []
    for mask in range(total):
        bits = {pid: (mask >> i) & 1 for i, pid in enumerate(pair_ids)}
        worlds.append([collapse_hypothetical(q, bits[q.pair_id]) for q in hand])
    return worlds


def envido_metric_mu_p28(hand: List[QuantumCard]) -> Tuple[float, float, int, int]:
    worlds = enumerate_worlds(hand)
    scores = [envido_score(w) for w in worlds]
    mu = sum(scores) / len(scores)
    p28 = sum(1 for x in scores if x >= 28) / len(scores)
    return (mu, p28, min(scores), max(scores))


def flor_metric(hand: List[QuantumCard]) -> Tuple[float, float, int, int]:
    worlds = enumerate_worlds(hand)
    vals = [flor_score(w) for w in worlds if has_flor(w)]
    p_flor = sum(1 for w in worlds if has_flor(w)) / len(worlds)
    if not vals:
        return (0.0, 0.0, -1, -1)
    return (sum(vals) / len(vals), p_flor, min(vals), max(vals))


# ============================================================
# Helpers CLI
# ============================================================

def ask(prompt: str, valid: Optional[List[str]] = None, allow_empty: bool = False) -> str:
    while True:
        s = input(prompt).strip()
        if allow_empty and s == "":
            return s
        if valid is None:
            return s
        if s.lower() in [v.lower() for v in valid]:
            return s
        print(f"Respuesta inválida. Opciones: {valid}")


def ask_choice_int(prompt: str, valid: List[int]) -> int:
    while True:
        s = input(prompt).strip()
        try:
            x = int(s)
        except ValueError:
            print("Ingresá un número.")
            continue
        if x in valid:
            return x
        print(f"Elegí una de estas opciones: {valid}")


def ask_int(prompt: str, lo: int, hi: int) -> int:
    while True:
        s = input(prompt).strip()
        try:
            x = int(s)
        except ValueError:
            print("Ingresá un número.")
            continue
        if lo <= x <= hi:
            return x
        print(f"Elegí un número entre {lo} y {hi}.")


def clear_screen(lines: int = 30) -> None:
    print("\n" * lines)


def choose_seat_from(prompt: str, valid_seats: List[int], players: List["Player"]) -> int:
    if len(valid_seats) == 1:
        return valid_seats[0]
    labels = ", ".join(f"{s}:{players[s].name}" for s in valid_seats)
    while True:
        s = input(f"{prompt} [{labels}]: ").strip()
        try:
            seat = int(s)
        except ValueError:
            print("Ingresá un asiento válido.")
            continue
        if seat in valid_seats:
            return seat
        print(f"Asiento inválido. Opciones: {valid_seats}")


# ============================================================
# Equipos y estados
# ============================================================

def team_of(seat: int) -> int:
    return seat % 2


# Niveles de Truco: (nombre, puntos_si_acepta, puntos_si_rechazan)
# "puntos_si_rechazan" = lo que cobra quien cantó el nivel ANTERIOR
TRUCO_LEVELS = [
    ("Base",    1,  0),   # nivel 0: nadie cantó aún, "ganar la mano" vale 1
    ("Truco",   2,  1),   # nivel 1: cantaron Truco, si rechazan cobra 1
    ("Retruco", 3,  2),   # nivel 2: cantaron Retruco, si rechazan cobra 2
    ("Vale 4",  4,  3),   # nivel 3: cantaron Vale 4, si rechazan cobra 3
]


@dataclass
class BetState:
    level: int = 0
    last_raiser_team: Optional[int] = None

    def current_points(self) -> int:
        """Puntos que vale la mano en el estado actual (si se termina sin rechazo)."""
        return TRUCO_LEVELS[self.level][1]

    def points_if_rejected(self) -> int:
        """Puntos que cobra el equipo que cantó si el oponente rechaza."""
        return TRUCO_LEVELS[self.level][2]

    def current_name(self) -> str:
        return TRUCO_LEVELS[self.level][0]

    def next_level(self) -> Optional[int]:
        return self.level + 1 if self.level < 3 else None

    def next_name_points(self) -> Tuple[Optional[str], Optional[int]]:
        nxt = self.next_level()
        if nxt is None:
            return None, None
        return TRUCO_LEVELS[nxt][0], TRUCO_LEVELS[nxt][1]

    def allowed_raise_team(self) -> Optional[int]:
        """Equipo que puede subir la apuesta ahora (el que NO cantó último)."""
        if self.level == 0:
            return None  # aún no se cantó, cualquiera puede iniciar
        if self.last_raiser_team is None:
            return None
        return 1 - self.last_raiser_team


@dataclass
class Player:
    name: str
    seat: int
    hand: List[QuantumCard]
    played: List[QuantumCard]
    metric: Tuple[float, float, int, int]
    flor_metric_data: Tuple[float, float, int, int]
    declared_metric: str = ""


# ============================================================
# Estado de Envido / Flor
# ============================================================

# Niveles de Envido acumulables (nombre, puntos_base_que_suma)
# La apuesta acumulada se resuelve al final.
ENVIDO_CALLS = ["envido", "real envido", "falta envido"]

# Puntos que vale cada call individualmente cuando se acepta
ENVIDO_CALL_PTS = {
    "envido":       2,
    "real envido":  3,
    "falta envido": None,  # especial: calculado en runtime
}

# Puntos que cobra el que cantó si rechazan en cada nivel acumulado
# La regla: si rechazan, cobra lo que valía el nivel ANTERIOR aceptado + 1
# Se calcula dinámicamente en EnvidoState


@dataclass
class EnvidoState:
    """Maneja la secuencia de cantos de envido/real envido/falta envido."""
    calls: List[str] = field(default_factory=list)       # secuencia de cantos hechos
    accepted: bool = False
    resolved: bool = False
    caller_team: Optional[int] = None
    caller_seat: Optional[int] = None
    responder_seat: Optional[int] = None
    declarations: Dict[int, str] = field(default_factory=dict)

    def total_points_if_accepted(self, target: int, scores: List[int]) -> int:
        """Calcula los puntos totales acumulados si se acepta el estado actual."""
        total = 0
        for call in self.calls:
            if call == "falta envido":
                losing_team = 1 - (self.caller_team or 0)
                total += max(target - scores[losing_team], 1)
            else:
                total += ENVIDO_CALL_PTS[call]  # type: ignore
        return total

    def points_if_rejected(self, target: int, scores: List[int]) -> int:
        """
        Si rechazan, el que cantó cobra:
        - Si no había nada cantado antes: 1 punto por cada call excepto el último
          (el último es el que se rechazó).
        Regla simplificada usada habitualmente:
        - Rechazo del primer envido: 1
        - Rechazo de "envido envido": 2
        - Rechazo de "envido real envido": 3 (los 2 del primero + 1)
        - Rechazo de "falta envido" (directo): 1
        - En general: suma de todos los calls anteriores al último.
        """
        if not self.calls:
            return 0
        # Puntos sin el último call
        prev_calls = self.calls[:-1]
        if not prev_calls:
            return 1  # primer call rechazado siempre vale 1
        total = 0
        for call in prev_calls:
            if call == "falta envido":
                losing_team = 1 - (self.caller_team or 0)
                total += max(target - scores[losing_team], 1)
            else:
                total += ENVIDO_CALL_PTS[call]  # type: ignore
        return max(total, 1)

    def can_raise(self, last_call: str) -> List[str]:
        """Retorna la lista de cantos posibles para subir desde el último call."""
        if last_call == "falta envido":
            return []  # no se puede subir más
        if last_call == "real envido":
            return ["falta envido"]
        if last_call == "envido":
            return ["envido", "real envido", "falta envido"]
        return []


@dataclass
class FlorState:
    """Maneja los cantos de Flor y Contraflor."""
    sung_by_seat: Dict[int, bool] = field(default_factory=dict)   # seat -> cantó flor?
    declarations: Dict[int, str] = field(default_factory=dict)
    contraflor_called: bool = False
    contraflor_caller_team: Optional[int] = None
    contraflor_al_resto: bool = False
    contraflor_accepted: bool = False
    resolved: bool = False

    def teams_with_flor(self, active_seats: List[int]) -> Set[int]:
        return {team_of(s) for s in active_seats if self.sung_by_seat.get(s, False)}


@dataclass
class ChantState:
    flor: FlorState = field(default_factory=FlorState)
    envido: EnvidoState = field(default_factory=EnvidoState)
    flor_blocked_envido: bool = False  # flor real impidió envido


# ============================================================
# Reglas de elegibilidad y orden
# ============================================================

def circular_order(active_seats: List[int], start_seat: int, table_size: int) -> List[int]:
    active = set(active_seats)
    out: List[int] = []
    for i in range(table_size):
        s = (start_seat + i) % table_size
        if s in active:
            out.append(s)
    return out


def eligible_initial_callers(active_seats: List[int], mano_seat: int, table_size: int) -> Set[int]:
    if len(active_seats) == 2:
        return set(active_seats)
    order = circular_order(active_seats, mano_seat, table_size)
    return {order[-1], order[-2]}  # los dos pies


def opposing_team_seats(active_seats: List[int], acting_team: int) -> List[int]:
    return [s for s in active_seats if team_of(s) != acting_team]


# ============================================================
# Mostrar mano
# ============================================================

def show_hand_with_metric(p: Player, con_flor: bool) -> None:
    mu, p28, mn, mx = p.metric
    fmu, p_flor, fmin, fmax = p.flor_metric_data

    print(f"{p.name} (asiento {p.seat}, equipo {team_of(p.seat)}) — TU MANO:")
    for i, q in enumerate(p.hand, start=1):
        print(f"  {i}. {q.label()}")

    print("\nMétrica REAL de Envido (calculada por la app):")
    print(f"  μ={mu:.2f} | P(Envido≥28)={p28:.2f} | rango=[{mn},{mx}]")

    if con_flor:
        print("Métrica REAL de Flor:")
        if p_flor == 0.0:
            print("  Sin posibilidad de flor en ningún mundo cuántico.")
        elif p_flor == 1.0:
            print(f"  ¡Flor garantizada! μ_flor={fmu:.2f} | rango=[{fmin},{fmax}]")
        else:
            print(f"  P(tener flor)={p_flor:.0%} | μ_flor={fmu:.2f} | rango=[{fmin},{fmax}]")
            print(f"  (En {p_flor:.0%} de los mundos cuánticos tenés flor)")


# ============================================================
# Ventana Flor / Envido
# ============================================================

def _resolve_envido_call_sequence(
    initial_caller_seat: int,
    first_call: str,
    players: List[Player],
    active_seats: List[int],
    chant: ChantState,
    target: int,
    scores: List[int],
) -> None:
    """
    Gestiona la secuencia completa de cantos de envido:
    cada lado puede subir la apuesta o aceptar/rechazar.
    """
    env = chant.envido
    env.caller_team = team_of(initial_caller_seat)
    env.caller_seat = initial_caller_seat
    env.calls.append(first_call)

    dec = ask(
        f"{players[initial_caller_seat].name}: declarás tu métrica (podés mentir). Enter para saltear: ",
        allow_empty=True,
    )
    env.declarations[initial_caller_seat] = dec

    # El otro equipo responde
    acting_team = team_of(initial_caller_seat)
    opp_seats = opposing_team_seats(active_seats, acting_team)
    responder_seat = choose_seat_from("¿Quién del otro equipo responde?", opp_seats, players)
    env.responder_seat = responder_seat
    responder = players[responder_seat]

    while True:
        current_pts = env.total_points_if_accepted(target, scores)
        reject_pts  = env.points_if_rejected(target, scores)
        last_call   = env.calls[-1]
        possible_raises = env.can_raise(last_call)

        print(f"\n  [{last_call.upper()}] — acepta: {current_pts} pts | rechaza: {reject_pts} pts para equipo {env.caller_team}")

        opts = ["q", "n"]  # quiero, no quiero
        prompt_parts = ["q=quiero", "n=no quiero"]
        for raise_call in possible_raises:
            short = raise_call[0]  # e=envido, r=real, f=falta
            opts.append(short)
            prompt_parts.append(f"{short}={raise_call}")

        resp = ask(
            f"{responder.name}: [{' / '.join(prompt_parts)}]: ",
            valid=opts,
        ).lower()

        if resp == "n":
            pts = env.points_if_rejected(target, scores)
            print(f"No quiero. Equipo {env.caller_team} cobra {pts} pts.")
            env.resolved = True
            scores[env.caller_team] += pts  # type: ignore
            return

        if resp == "q":
            pts = env.total_points_if_accepted(target, scores)
            print(f"¡Quiero! El envido vale {pts} pts → se liquida al FINAL de la mano.")
            env.accepted = True
            env.resolved = True
            return

        # Subió la apuesta
        for raise_call in possible_raises:
            if resp == raise_call[0]:
                env.calls.append(raise_call)
                dec2 = ask(
                    f"{responder.name}: declarás tu métrica. Enter para saltear: ",
                    allow_empty=True,
                )
                env.declarations[responder_seat] = dec2
                print(f"  {responder.name} canta {raise_call.upper()}.")

                # Ahora el turno vuelve al que cantó originalmente (o al equipo que lo hizo)
                # En partidas de más de 2 jugadores, cualquier compañero puede responder
                orig_team_seats = [s for s in active_seats if team_of(s) == env.caller_team]
                new_responder_seat = choose_seat_from(
                    f"¿Quién del equipo {env.caller_team} responde el {raise_call}?",
                    orig_team_seats,
                    players,
                )
                env.responder_seat = new_responder_seat
                responder = players[new_responder_seat]
                # Intercambiamos roles: ahora el que recibió la subida es el "caller"
                acting_team = team_of(responder_seat)
                env.caller_team = acting_team  # type: ignore
                break


def chant_window(
    players: List[Player],
    active_seats: List[int],
    mano_seat: int,
    table_size: int,
    chant: ChantState,
    con_flor: bool,
    target: int,
    scores: List[int],
) -> None:
    eligible = eligible_initial_callers(active_seats, mano_seat, table_size)
    order = circular_order(active_seats, mano_seat, table_size)

    print("\n--- Ventana Flor / Envido ---")
    print(f"Pueden cantar inicialmente: {[players[s].name for s in sorted(eligible)]}")

    # =========================================================
    # 1) Flor
    # =========================================================
    if con_flor:
        flor = chant.flor
        any_flor_sung = False

        for seat in order:
            if seat not in eligible:
                continue
            p = players[seat]
            _, p_flor, _, _ = p.flor_metric_data
            hint = f" [P(flor)={p_flor:.0%}]" if p_flor > 0 else " [sin posibilidad de flor]"
            ans = ask(f"{p.name}{hint}: ¿Cantás Flor? [s/n]: ", valid=["s", "n"]).lower()
            if ans == "s":
                any_flor_sung = True
                flor.sung_by_seat[seat] = True
                dec = ask(
                    f"{p.name}: declarás tu flor (podés mentir). Enter para saltear: ",
                    allow_empty=True,
                )
                flor.declarations[seat] = dec

        if any_flor_sung:
            teams_flor = flor.teams_with_flor(active_seats)
            # Ambos equipos tienen (cuánticamente) flor: posibilidad de Contraflor
            if len(teams_flor) == 2:
                # El equipo que cantó último puede cantar contraflor
                last_flor_seat = max(
                    (s for s in order if flor.sung_by_seat.get(s, False)),
                    key=lambda s: order.index(s),
                )
                cf_team = team_of(last_flor_seat)
                ans_cf = ask(
                    f"Hay flor en ambos equipos. Equipo {cf_team} ({players[last_flor_seat].name}): "
                    f"¿Cantás Contraflor? [s/n/r=al resto]: ",
                    valid=["s", "n", "r"],
                ).lower()

                if ans_cf in ("s", "r"):
                    flor.contraflor_called = True
                    flor.contraflor_caller_team = cf_team
                    flor.contraflor_al_resto = (ans_cf == "r")

                    opp_cf = opposing_team_seats(active_seats, cf_team)
                    resp_cf_seat = choose_seat_from("¿Quién responde la Contraflor?", opp_cf, players)
                    cf_label = "Contraflor al Resto" if flor.contraflor_al_resto else "Contraflor"
                    ans_resp = ask(
                        f"{players[resp_cf_seat].name}: ¿Aceptás {cf_label}? [s/n]: ",
                        valid=["s", "n"],
                    ).lower()
                    flor.contraflor_accepted = (ans_resp == "s")
                    if flor.contraflor_accepted:
                        print(f"{cf_label} ACEPTADA → se liquida al FINAL de la mano.")
                    else:
                        print(f"{cf_label} rechazada → Equipo {cf_team} cobra 3 pts.")

            print("Se cantó Flor. NO habrá Envido en esta mano (se liquida al final).")
            return

    # =========================================================
    # 2) Envido  (solo si no hubo flor)
    # =========================================================
    for seat in order:
        if seat not in eligible:
            continue
        p = players[seat]

        env_opts_str = "e=envido / r=real envido / f=falta envido / n=no"
        env_valid = ["e", "r", "f", "n"]
        ans = ask(
            f"{p.name}: ¿Cantás envido? [{env_opts_str}]: ",
            valid=env_valid,
        ).lower()

        first_call_map = {"e": "envido", "r": "real envido", "f": "falta envido"}
        if ans == "n":
            continue

        first_call = first_call_map[ans]
        print(f"  {p.name} canta {first_call.upper()}.")
        _resolve_envido_call_sequence(seat, first_call, players, active_seats, chant, target, scores)
        return  # el envido solo se canta una vez por mano

    print("No se cantó Envido ni Flor.")


# ============================================================
# Truco: raise rights + aceptación
# ============================================================

def can_team_raise_now(bet: BetState, acting_team: int) -> bool:
    nxt = bet.next_level()
    if nxt is None:
        return False
    if bet.level == 0:
        # Nadie cantó aún: cualquiera puede iniciar el Truco
        return True
    allowed = bet.allowed_raise_team()
    return allowed is not None and allowed == acting_team


def handle_raise_cli(
    bet: BetState,
    acting_seat: int,
    players: List[Player],
    active_seats: List[int],
    local_scores: List[int],
) -> Optional[int]:
    """
    Intenta subir la apuesta de Truco.
    Retorna el equipo ganador si la mano termina (rechazo), o None si continúa.
    """
    acting_team = team_of(acting_seat)
    if not can_team_raise_now(bet, acting_team):
        return None

    nxt_name, nxt_pts = bet.next_name_points()
    if nxt_name is None or nxt_pts is None:
        return None

    cur_pts  = bet.current_points()
    rej_pts  = bet.points_if_rejected()

    ans = ask(
        f"{players[acting_seat].name}: ¿Querés cantar {nxt_name}? "
        f"(apuesta actual={cur_pts}, rechazar vale {rej_pts} pts) [s/n]: ",
        valid=["s", "n"],
    ).lower()
    if ans != "s":
        return None

    opp_seats = opposing_team_seats(active_seats, acting_team)
    responder_seat = choose_seat_from(
        f"¿Quién del equipo contrario responde {nxt_name}?", opp_seats, players
    )
    responder = players[responder_seat]

    # El equipo receptor puede aceptar, rechazar, o (si hay nivel siguiente) subir más
    while True:
        can_raise_back = bet.next_level() is not None  # hay nivel siguiente al que se cantó
        # Nota: la respuesta posible es solo quiero/no quiero (subir es el próximo turno del juego)
        resp = ask(
            f"{responder.name}: ¿Aceptás {nxt_name}? [s/n]: ",
            valid=["s", "n"],
        ).lower()
        break

    if resp == "s":
        bet.level += 1
        bet.last_raiser_team = acting_team
        print(f"¡Quiero! Se acepta {nxt_name}. La mano vale {nxt_pts} pts.")
        return None

    print(f"{responder.name} no quiere. Equipo {acting_team} cobra {rej_pts} pts.")
    local_scores[acting_team] += rej_pts
    return acting_team


# ============================================================
# Mazo
# ============================================================

def handle_fold_to_mazo(
    acting_seat: int,
    players: List[Player],
    bet: BetState,
    local_scores: List[int],
) -> int:
    acting_team = team_of(acting_seat)
    opp_team    = 1 - acting_team
    pts         = bet.current_points()
    print(f"{players[acting_seat].name} se va al mazo → Equipo {opp_team} cobra {pts} pts.")
    local_scores[opp_team] += pts
    return opp_team


# ============================================================
# Resolución de baza y mano
# ============================================================

def trick_winner(
    collapsed_by_seat: Dict[int, Card],
    play_order: List[int],
) -> Tuple[int, Optional[int]]:
    """
    Devuelve (equipo_ganador, asiento_ganador_real).
    Si hay parda entre equipos distintos -> (-1, None).
    Si varias máximas son del mismo equipo, gana la que salió primero.
    """
    best_power = max(truco_power(c) for c in collapsed_by_seat.values())
    best_seats = [seat for seat in play_order if truco_power(collapsed_by_seat[seat]) == best_power]
    best_teams = {team_of(seat) for seat in best_seats}

    if len(best_teams) > 1:
        return -1, None

    win_seat = best_seats[0]
    return team_of(win_seat), win_seat


def resolve_hand_truco(trick_winners: List[int], mano_team: int) -> int:
    """
    Determina el equipo ganador de la mano de truco.

    Reglas:
    - Gana quien gana 2 bazas.
    - Si hay pardas: el primer ganador no-parda prevalece.
    - Todas pardas: gana el mano.
    """
    w0 = sum(1 for w in trick_winners if w == 0)
    w1 = sum(1 for w in trick_winners if w == 1)

    if w0 >= 2:
        return 0
    if w1 >= 2:
        return 1

    # Menos de 2 bazas decididas para cada equipo
    non = [w for w in trick_winners if w in (0, 1)]

    if len(non) == 1:
        # Una sola baza ganada (ej: [0,-1,-1] o [-1,1,-1])
        return non[0]

    if all(w == -1 for w in trick_winners):
        # Todas pardas: gana el mano
        return mano_team

    if non:
        # Cada equipo ganó una baza y hubo al menos una parda
        # → gana quien ganó la PRIMERA baza (non[0])
        return non[0]   # CORREGIDO: era non[-1]

    return mano_team


# ============================================================
# Fin de mano: colapso + liquidación Envido / Flor
# ============================================================

def reveal_and_settle_chants(
    deck: QuantumDeck,
    players: List[Player],
    active_seats: List[int],
    chant: ChantState,
    local_scores: List[int],
    mano_team: int,
    target: int,
    scores_global: List[int],
) -> None:
    for seat in active_seats:
        deck.collapse_all(players[seat].hand)

    final_cards: Dict[int, List[Card]] = {}
    for seat in active_seats:
        p = players[seat]
        final_cards[seat] = [deck.collapse(q) for q in (p.played + p.hand)]

    print("\n=== Fin de la mano: colapso final ===")
    for seat in active_seats:
        p = players[seat]
        cards_str = ", ".join(str(c) for c in final_cards[seat])
        print(f"{p.name} (equipo {team_of(seat)}): {cards_str}")

    # =========================================================
    # Liquidar Flor
    # =========================================================
    flor = chant.flor
    any_real_flor: Dict[int, int] = {}  # team -> mejor flor real

    if any(flor.sung_by_seat.get(s, False) for s in active_seats):
        print("\n--- Flor: declaraciones ---")
        for seat, dec in flor.declarations.items():
            if seat in active_seats and dec.strip():
                print(f"  {players[seat].name}: declaró → {dec}")

        print("\n--- Flor: métricas reales al colapsar ---")
        for seat in active_seats:
            if has_flor(final_cards[seat]):
                fs = flor_score(final_cards[seat])
                t  = team_of(seat)
                any_real_flor[t] = max(any_real_flor.get(t, -1), fs)
                print(f"  {players[seat].name}: TIENE FLOR real (score={fs})")
            else:
                print(f"  {players[seat].name}: no tiene flor real")

        if not any_real_flor:
            # Nadie tuvo flor real al colapsar → resolver como envido normal
            print("\nNadie tuvo flor real. Se resuelve como ENVIDO normal.")
            _settle_envido_normal(final_cards, active_seats, players, local_scores, mano_team, target, scores_global, pts=2)
            return

        # Contraflor al resto
        if flor.contraflor_al_resto and flor.contraflor_accepted:
            winner_team = _flor_winner(any_real_flor, mano_team)
            loser_team  = 1 - winner_team
            pts_al_resto = max(target - scores_global[loser_team], 1)
            print(f"\nContraflor AL RESTO → Equipo {winner_team} gana la partida (+{pts_al_resto})")
            local_scores[winner_team] += pts_al_resto
            return

        # Contraflor normal (aceptada)
        if flor.contraflor_called and flor.contraflor_accepted:
            winner_team = _flor_winner(any_real_flor, mano_team)
            # Contraflor vale la diferencia de puntos de flor + 3 base
            vals = list(any_real_flor.values())
            if len(vals) == 2:
                pts_cf = abs(vals[0] - vals[1]) + 3
            else:
                pts_cf = 3
            print(f"\nContraflor ACEPTADA → Equipo {winner_team} cobra {pts_cf} pts")
            local_scores[winner_team] += pts_cf
            return

        # Contraflor rechazada
        if flor.contraflor_called and not flor.contraflor_accepted:
            # Ya se contabilizó el rechazo en chant_window (3 pts al caller)
            caller_t = flor.contraflor_caller_team
            if caller_t is not None:
                print(f"\nContraflor rechazada → Equipo {caller_t} ya cobró 3 pts.")
                local_scores[caller_t] += 3
            return

        # Flor simple
        print("\n--- Flor simple: liquidación ---")
        if len(any_real_flor) == 1:
            t = next(iter(any_real_flor))
            print(f"Solo Equipo {t} tuvo flor real → cobra 3 pts.")
            local_scores[t] += 3
        else:
            print(f"  Equipo 0 flor = {any_real_flor.get(0, '—')}")
            print(f"  Equipo 1 flor = {any_real_flor.get(1, '—')}")
            winner_team = _flor_winner(any_real_flor, mano_team)
            print(f"  Gana Flor: Equipo {winner_team} (+3)")
            local_scores[winner_team] += 3
        return

    # =========================================================
    # Liquidar Envido
    # =========================================================
    env = chant.envido
    if not env.resolved:
        return  # no se cantó envido

    if not env.accepted:
        # Ya se contabilizó el rechazo en _resolve_envido_call_sequence
        print("\n--- Envido rechazado (ya contabilizado) ---")
        return

    print("\n--- Envido aceptado: declaraciones ---")
    for seat, dec in env.declarations.items():
        if seat in active_seats and dec.strip():
            print(f"  {players[seat].name}: declaró → {dec}")

    pts = env.total_points_if_accepted(target, scores_global)
    _settle_envido_normal(final_cards, active_seats, players, local_scores, mano_team, target, scores_global, pts=pts)


def _flor_winner(any_real_flor: Dict[int, int], mano_team: int) -> int:
    if len(any_real_flor) == 1:
        return next(iter(any_real_flor))
    if any_real_flor.get(0, -1) > any_real_flor.get(1, -1):
        return 0
    if any_real_flor.get(1, -1) > any_real_flor.get(0, -1):
        return 1
    return mano_team  # empate: gana el mano


def _settle_envido_normal(
    final_cards: Dict[int, List[Card]],
    active_seats: List[int],
    players: List[Player],
    local_scores: List[int],
    mano_team: int,
    target: int,
    scores_global: List[int],
    pts: int,
) -> None:
    """Resuelve el envido con las cartas reales colapsadas."""
    print("\n--- Envido: puntuaciones reales ---")
    team_scores = {0: 0, 1: 0}
    per_seat    = {}
    for seat in active_seats:
        e = envido_score(final_cards[seat])
        per_seat[seat] = e
        team_scores[team_of(seat)] = max(team_scores[team_of(seat)], e)
        print(f"  {players[seat].name}: {e}")

    print(f"  Equipo 0 (máx) = {team_scores[0]}  |  Equipo 1 (máx) = {team_scores[1]}")

    if team_scores[0] > team_scores[1]:
        print(f"  Gana Envido: Equipo 0 (+{pts})")
        local_scores[0] += pts
    elif team_scores[1] > team_scores[0]:
        print(f"  Gana Envido: Equipo 1 (+{pts})")
        local_scores[1] += pts
    else:
        print(f"  Empate → gana MANO (Equipo {mano_team}) (+{pts})")
        local_scores[mano_team] += pts


# ============================================================
# Mano genérica sobre jugadores ya repartidos
# ============================================================

def play_active_hand(
    deck: QuantumDeck,
    players: List[Player],
    active_seats: List[int],
    mano_seat: int,
    table_size: int,
    con_flor: bool,
    target: int,
    scores_global: List[int],
    show_hands_first: bool = False,
) -> List[int]:
    """
    Juega una mano con los active_seats dados.
    Devuelve delta de puntaje [eq0, eq1].
    """
    local_scores = [0, 0]

    if show_hands_first:
        for seat in active_seats:
            clear_screen()
            show_hand_with_metric(players[seat], con_flor)
            input("\n(Enter para continuar — que mire el siguiente jugador...)")
        clear_screen(8)

    mano_team = team_of(mano_seat)
    bet   = BetState()
    chant = ChantState()

    # ---- Ventana de Flor / Envido (solo en la primera baza) ----
    chant_window(
        players, active_seats, mano_seat, table_size,
        chant, con_flor, target, scores_global,
    )

    trick_winners: List[int] = []
    leader_seat   = mano_seat
    first_trick   = True

    for trick_idx in range(3):
        print("\n====================================")
        print(f"BAZA {trick_idx + 1} — líder: {players[leader_seat].name} (eq {team_of(leader_seat)})")
        print(f"Apuesta Truco actual: {bet.current_name()} = {bet.current_points()} pts")
        print("====================================")

        order  = circular_order(active_seats, leader_seat, table_size)
        plays:    Dict[int, QuantumCard] = {}
        collapsed: Dict[int, Card] = {}

        for seat in order:
            p           = players[seat]
            acting_team = team_of(seat)

            while True:
                opts         = ["j", "m"]
                prompt_parts = ["j=jugar", "m=irse al mazo"]

                if can_team_raise_now(bet, acting_team):
                    nxt_name, _ = bet.next_name_points()
                    opts.append("t")
                    prompt_parts.append(f"t=cantar {nxt_name}")

                action = ask(
                    f"{p.name} (eq {acting_team}) — [{' / '.join(prompt_parts)}]: ",
                    valid=opts,
                ).lower()

                if action == "t":
                    ended_team = handle_raise_cli(bet, seat, players, active_seats, local_scores)
                    if ended_team is not None:
                        reveal_and_settle_chants(
                            deck, players, active_seats, chant,
                            local_scores, mano_team, target, scores_global,
                        )
                        return local_scores
                    continue

                elif action == "m":
                    handle_fold_to_mazo(seat, players, bet, local_scores)
                    reveal_and_settle_chants(
                        deck, players, active_seats, chant,
                        local_scores, mano_team, target, scores_global,
                    )
                    return local_scores

                else:
                    break  # jugar carta

            print(f"\n{p.name} — tus cartas restantes:")
            for i, q in enumerate(p.hand, start=1):
                print(f"  {i}. {q.label()}")
            idx = ask_int(f"{p.name}: elegí carta (1-{len(p.hand)}): ", 1, len(p.hand))
            q   = p.hand.pop(idx - 1)
            p.played.append(q)
            plays[seat] = q
            print(f"{p.name} juega (cuántica): {q.label()}")

        print("\n>>> Fin de la baza: colapsan las cartas jugadas")
        for seat in order:
            q              = plays[seat]
            collapsed[seat] = deck.collapse(q)
            print(f"  {players[seat].name}: {collapsed[seat]} (poder={truco_power(collapsed[seat])})")

        win_team, win_seat = trick_winner(collapsed, order)
        if win_team == -1:
            print("Resultado: PARDA")
        else:
            print(f"Resultado: gana Equipo {win_team} ({players[win_seat].name})")  # type: ignore

        trick_winners.append(win_team)
        if win_seat is not None:
            leader_seat = win_seat

        first_trick = False

        w0 = sum(1 for w in trick_winners if w == 0)
        w1 = sum(1 for w in trick_winners if w == 1)
        if w0 == 2 or w1 == 2:
            break

    hand_winner = resolve_hand_truco(trick_winners, mano_team)
    pts         = bet.current_points()
    print("\n=== RESULTADO DE LA MANO (TRUCO) ===")
    print(f"Apuesta final: {bet.current_name()} = {pts} pts")
    print(f"Ganador: Equipo {hand_winner} (+{pts})")
    local_scores[hand_winner] += pts

    reveal_and_settle_chants(
        deck, players, active_seats, chant,
        local_scores, mano_team, target, scores_global,
    )
    return local_scores


# ============================================================
# Mano grupal normal (2/4/6)
# ============================================================

def build_players_for_new_deck(deck: QuantumDeck, table_size: int) -> List[Player]:
    players: List[Player] = []
    for seat in range(table_size):
        hand = deck.deal(3)
        players.append(
            Player(
                name=f"Jugador {seat + 1}",
                seat=seat,
                hand=hand,
                played=[],
                metric=envido_metric_mu_p28(hand),
                flor_metric_data=flor_metric(hand),
            )
        )
    return players


def play_normal_hand(
    rng: random.Random,
    table_size: int,
    mano_seat: int,
    con_flor: bool,
    target: int,
    scores_global: List[int],
) -> List[int]:
    deck    = QuantumDeck(rng)
    players = build_players_for_new_deck(deck, table_size)
    return play_active_hand(
        deck=deck,
        players=players,
        active_seats=list(range(table_size)),
        mano_seat=mano_seat,
        table_size=table_size,
        con_flor=con_flor,
        target=target,
        scores_global=scores_global,
        show_hands_first=True,
    )


# ============================================================
# Pica (6 jugadores) con mazo compartido
# ============================================================

def should_play_pica(
    table_size: int,
    pica_enabled: bool,
    scores: List[int],
    pica_min: int,
    pica_max: int,
) -> bool:
    if table_size != 6 or not pica_enabled:
        return False
    return pica_min <= scores[0] <= pica_max and pica_min <= scores[1] <= pica_max


def play_pica_round(
    rng: random.Random,
    mano_seat: int,
    con_flor: bool,
    pica_mode: str,
    target: int,
    scores_global: List[int],
) -> List[int]:
    print("\n############################################")
    print("          RONDA DE PICA (6 jugadores)")
    print("############################################")

    deck    = QuantumDeck(rng)
    players = build_players_for_new_deck(deck, 6)

    for seat in range(6):
        clear_screen()
        show_hand_with_metric(players[seat], con_flor)
        input("\n(Enter para continuar — que mire el siguiente jugador...)")
    clear_screen(8)

    duel_pairs   = [(0, 1), (2, 3), (4, 5)]
    total        = [0, 0]
    global_order = circular_order(list(range(6)), mano_seat, 6)

    for a, b in duel_pairs:
        duel_order = [s for s in global_order if s in (a, b)]
        duel_mano  = duel_order[0]

        print("\n===================================================")
        print(f"PICA: submano {players[a].name} vs {players[b].name}")
        print(f"Abre: {players[duel_mano].name}")
        print("===================================================")

        delta = play_active_hand(
            deck=deck,
            players=players,
            active_seats=[a, b],
            mano_seat=duel_mano,
            table_size=6,
            con_flor=con_flor,
            target=target,
            scores_global=scores_global,
            show_hands_first=False,
        )
        total[0] += delta[0]
        total[1] += delta[1]

        print(f"\nAcumulado pica: Equipo 0 = {total[0]} | Equipo 1 = {total[1]}")
        input("\n(Enter para la siguiente submano de pica...)")

    print("\n########### FIN DE LA PICA ###########")
    print(f"Acumulado bruto: Equipo 0 = {total[0]} | Equipo 1 = {total[1]}")

    if pica_mode == "total":
        print("Modo: TOTAL")
        return total

    diff = abs(total[0] - total[1])
    out  = [0, 0]
    if total[0] > total[1]:
        out[0] = diff
    elif total[1] > total[0]:
        out[1] = diff
    print(f"Modo: DIFERENCIA → delta = {out}")
    return out


# ============================================================
# Match loop
# ============================================================

def run_match() -> None:
    print("Quantum Truco — partida")

    table_size = ask_choice_int("Cantidad de jugadores (2, 4 o 6): ", [2, 4, 6])
    target     = ask_choice_int("¿A cuántos puntos? (15 o 30): ", [15, 30])
    con_flor   = ask("¿Se juega con Flor? [s/n]: ", valid=["s", "n"]).lower() == "s"

    pica_enabled = False
    pica_mode    = "total"
    pica_min     = 5
    pica_max     = 25

    if table_size == 6:
        pica_enabled = ask("¿Activar ronda de pica? [s/n]: ", valid=["s", "n"]).lower() == "s"
        if pica_enabled:
            pica_mode = ask(
                "Modo de puntuación de pica [total/diferencia]: ",
                valid=["total", "diferencia"],
            ).lower()
            print("La pica se jugará entre los puntos 5 y 25 (inclusive).")

    seed_in = ask("Seed (Enter para aleatoria): ", allow_empty=True)
    rng     = random.Random(int(seed_in) if seed_in else None)

    scores   = [0, 0]
    mano_seat = 0
    hand_num  = 1

    print("\nEquipos (asientos alternados):")
    team0 = [i for i in range(table_size) if team_of(i) == 0]
    team1 = [i for i in range(table_size) if team_of(i) == 1]
    print(f"  Equipo 0: {[f'Jugador {i+1} (seat {i})' for i in team0]}")
    print(f"  Equipo 1: {[f'Jugador {i+1} (seat {i})' for i in team1]}")

    while max(scores) < target:
        print("\n=================================================")
        print(f"MANO #{hand_num} | MANO seat={mano_seat} (Equipo {team_of(mano_seat)})")
        print(f"Puntaje: Equipo 0 = {scores[0]} | Equipo 1 = {scores[1]} | Objetivo = {target}")
        print("=================================================")

        if should_play_pica(table_size, pica_enabled, scores, pica_min, pica_max):
            delta = play_pica_round(rng, mano_seat, con_flor, pica_mode, target, scores)
        else:
            delta = play_normal_hand(rng, table_size, mano_seat, con_flor, target, scores)

        scores[0] += delta[0]
        scores[1] += delta[1]

        print("\n>>> Puntaje actualizado:")
        print(f"Equipo 0 = {scores[0]} | Equipo 1 = {scores[1]}")

        if max(scores) >= target:
            break

        input("\n(Enter para la próxima mano...)")
        mano_seat = (mano_seat + 1) % table_size
        hand_num  += 1

    winner = 0 if scores[0] >= target else 1
    print("\n====================")
    print(" FIN DE LA PARTIDA ")
    print("====================")
    print(f"Ganó el Equipo {winner} con {scores[winner]} puntos.")
    print(f"Marcador final: Equipo 0 = {scores[0]} | Equipo 1 = {scores[1]}")


if __name__ == "__main__":
    run_match()